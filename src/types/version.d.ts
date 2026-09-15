/**
 * 扩展版本号。
 * 该常量由 esbuild 在构建时通过 `define` 注入，值来自 package.json 的 version 字段，
 * 因此源码中不要再硬编码版本号。
 */
declare const __EXT_VERSION__: string
