/**
 * @typedef {Object} SocketAddress
 *
 * The hostname to connect to. Example: `gopher.floodgap.com`.
 * @property {string} hostname
 *
 * The port number to connect to. Example: `70`.
 * @property {number} port
 */

/**
 * @typedef {(string|SocketAddress)} AnySocketAddress
 */

/**
 * @typedef {Object} SocketOptions
 *
 * Specifies whether or not to use TLS when creating the TCP socket.
 * `off` — Do not use TLS.
 * `on` — Use TLS.
 * `starttls` — Do not use TLS initially, but allow the socket to be upgraded to use TLS by calling startTls().
 * @property {'on'|'off'|'starttls'} [secureTransport]
 *
 * Defines whether the writable side of the TCP socket will automatically close on end-of-file (EOF).
 * When set to false, the writable side of the TCP socket will automatically close on EOF.
 * When set to true, the writable side of the TCP socket will remain open on EOF.
 * This option is similar to that offered by the Node.js net module and allows interoperability with code which utilizes it.
 * @property {boolean} [allowHalfOpen]
 */

/**
 * @typedef {Object} SocketInfo
 * @property {string} remoteAddress
 * @property {string} localAddress
 */

/**
 * @param {AnySocketAddress} address
 * @param {SocketOptions} [options]
 * @returns {Socket}
 */
export function connect(address, options) {
  if (typeof address === "string") {
    const url = new URL(`https://${address}`);
    address = {
      hostname: url.hostname,
      port: parseInt(url.port === "" ? "443" : url.port),
    };
  }
  return new Socket(address, options);
}

export class Socket {
  /**
   * @type {ReadableStream<Uint8Array>}
   */
  readable;
  /**
   * @type {WritableStream<Uint8Array>}
   */
  writable;
  /**
   * A promise that is resolved when the socket connection has been
   * successfully established, or is rejected if the connection fails.
   * For sockets which use secure-transport, the resolution of the `opened`
   * promise indicates the completion of the secure handshake.
   * @type {Promise<SocketInfo>}
   */
  opened;
  /**
   * A promise which can be used to keep track of the socket state. It gets
   * resolved under the following circumstances:
   * - the `close()` method is called on the socket
   * - the socket was constructed with the `allowHalfOpen` parameter set to
   *   `false`, the ReadableStream is being read from, and the remote
   *   connection sends a FIN packet (graceful closure) or a RST packet.
   * @type {Promise<void>}
   */
  closed;

  /** @type {boolean} */
  #allowHalfOpen;
  #closedResolve;
  #closedReject;
  /** @type {'on'|'off'|'starttls'} */
  #secureTransport;
  /** @type {Deno.Conn} */
  #socket;
  #writer;
  #reader;
  /** @type {boolean} */
  #startTlsCalled;

  /**
   * @param {SocketAddress|Promise<Conn>} addressOrSocket
   * @param {SocketOptions} [options]
   */
  constructor(addressOrSocket, options) {
    this.#allowHalfOpen = options?.allowHalfOpen ?? false;
    this.#secureTransport = options?.secureTransport ?? "off";

    this.closed = new Promise((resolve, reject) => {
      this.#closedResolve = (...args) => {
        resolve(...args);
      };
      this.#closedReject = (...args) => {
        reject(...args);
      };
    });

    if (isSocketAddress(addressOrSocket)) {
      /**
       * @type {Deno.ConnectTlsOptions}
       */
      const connectOptions = {
        hostname: addressOrSocket.hostname,
        port: addressOrSocket.port,
      };

      const resolve = (conn) => {
        this.#socket = conn;
        this.#writer = conn.writable.getWriter();
        this.#reader = conn.readable.getReader();

        this.#reader.closed.then(() => {
          if (!this.#allowHalfOpen) {
            this.close();
          }
        });

        return {
          remoteAddress: conn.remoteAddr,
          localAddress: conn.localAddr,
        };
      };
      if (this.#secureTransport === "on") {
        this.opened = Deno.connectTls(connectOptions).then(resolve);
      } else {
        this.opened = Deno.connect(connectOptions).then(resolve);
      }
    } else {
      this.opened = addressOrSocket.then(Deno.startTls).then(resolve);
    }

    this.readable = new ReadableStream({
      start: async () => {
        await this.opened;
      },
      pull: async (controller) => {
        const { value, done } = await this.#reader.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
    });

    this.writable = new WritableStream({
      start: async () => {
        await this.opened;
      },
      write: async (chunk) => {
        await this.#writer.write(chunk);
      },
    });
  }

  /**
   * Closes the socket
   * @returns {Promise<void>}
   */
  async close() {
    await this.opened;
    try {
      this.#socket.close();
    } catch {
      // ignore
    }

    this.#closedResolve();

    return this.closed;
  }

  /**
   * Start TLS handshake from an existing connection
   * @returns {Socket}
   */
  startTls() {
    if (this.#secureTransport !== "starttls") {
      throw new Error("secureTransport must be set to 'starttls'");
    }
    if (this.#startTlsCalled) {
      throw new Error("can only call startTls once");
    } else {
      this.#startTlsCalled = true;
    }

    return new Socket(this.opened, { secureTransport: "on" });
  }
}

/**
 * @param {unknown} address
 * @returns {boolean} whether the address is a SocketAddress
 */
function isSocketAddress(address) {
  return (
    typeof address === "object" &&
    address !== null &&
    Object.hasOwn(address, "hostname") &&
    Object.hasOwn(address, "port")
  );
}

// Learn more at https://deno.land/manual/examples/module_metadata#concepts
if (import.meta.main) {
  const [address, message] = Deno.args;
  const socket = connect(address);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const encoded = encoder.encode(message + "\r\n");
  await writer.write(encoded);

  await socket.readable.pipeTo(Deno.stdout.writable);

  await socket.close();
}
