/**
 * localtunnel 没有自带类型声明，这里按我们实际用到的 API 补充最小声明。
 * 用「函数 + 同名 namespace」的经典写法，让 `localtunnel.Tunnel` 也能作为类型使用。
 */
declare module 'localtunnel' {
  interface Tunnel {
    /** 公网地址，形如 https://xxxx.loca.lt（不含末尾斜杠） */
    url: string
    close(): void
    on(event: 'close', listener: () => void): void
    on(event: 'error', listener: (err: Error) => void): void
  }

  interface TunnelOptions {
    port: number
    subdomain?: string
    local_host?: string
    host?: string
  }

  function localtunnel(options: TunnelOptions): Promise<Tunnel>

  namespace localtunnel {
    export { Tunnel, TunnelOptions }
  }

  export = localtunnel
}
