# deno_socket

A Deno Implementation of the Cloudflare Socket API

Deno already has great support for TCP, but since Cloudflare proposed a 
[WinterCG spec](https://sockets-api.proposal.wintercg.org/), this provides the
same interface for Deno so we could migrate easier later on. 

Inspired by `@arrowood.dev/socket`, but with Deno's runtime APIs.

## Usage

```js
import { connect } from "https://deno.land/x/socket/mod.js";

export default {
  async fetch(request) {
    const gopherAddr = { hostname: "gopher.floodgap.com", port: 70 };
    const url = new URL(req.url);

    try {
      const socket = connect(gopherAddr);

      const writer = socket.writable.getWriter()
      const encoder = new TextEncoder();
      const encoded = encoder.encode(url.pathname + "\r\n");
      await writer.write(encoded);

      return new Response(socket.readable, { headers: { "Content-Type": "text/plain" } });
    } catch (error) {
      return new Response("Socket connection failed: " + error, { status: 500 });
    }
  }
};
```

The module can also be run as a simple CLI to send a message to a TCP server,
similar to the example above, but send response to `stdout`.

For example:

```shell
$ deno run --allow-net mod.js gopher.floodgap.com:70 /
```