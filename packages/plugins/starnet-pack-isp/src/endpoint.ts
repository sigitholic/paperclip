// Pure router transport rules, shared by the worker and the settings UI (no Node imports).

export type MikrotikProtocol = "api" | "rest";

/** One extra router in `mikrotikRouters`. The flat `mikrotik*` fields are the router named "default". */
export interface RouterConfig {
  name?: string;
  host?: string;
  protocol?: MikrotikProtocol;
  port?: number;
  useTls?: boolean;
  tlsVerify?: boolean;
  username?: string;
  password?: unknown; // secret_ref binding
}

const API_PORT = 8728;
const API_SSL_PORT = 8729;

/**
 * How to reach the router. The well-known API ports pick the API and its TLS mode, because
 * operators often disable www/www-ssl (REST) and expose only 8728/8729.
 */
export function mikrotikEndpoint(r: Pick<RouterConfig, "protocol" | "port" | "useTls">): { protocol: MikrotikProtocol; port: number; tls: boolean } {
  const protocol = r.protocol ?? (r.port === API_PORT || r.port === API_SSL_PORT ? "api" : "rest");
  switch (protocol) {
    case "api": {
      const tls = r.port === API_PORT ? false : r.port === API_SSL_PORT ? true : (r.useTls ?? false);
      return { protocol, port: r.port ?? (tls ? API_SSL_PORT : API_PORT), tls };
    }
    case "rest": {
      const tls = r.useTls ?? true;
      return { protocol, port: r.port ?? (tls ? 443 : 80), tls };
    }
    default: {
      const unknown: never = protocol;
      throw new Error(`unknown mikrotikProtocol ${String(unknown)}`);
    }
  }
}
