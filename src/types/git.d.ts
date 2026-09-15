// Type definitions for the VS Code built-in Git extension API
// Copied from https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts

export interface GitExtension {
  readonly enabled: boolean
  readonly onDidChangeEnablement: Event<boolean>
  getAPI(version: 1): API
}

export interface API {
  readonly state: APIState
  readonly onDidChangeState: Event<APIState>
  readonly onDidOpenRepository: Event<Repository>
  readonly onDidCloseRepository: Event<Repository>
  readonly repositories: Array<Repository>
  toGitUri(uri: Uri, ref: string): Uri
  getRepository(uri: Uri): Repository | null
  init(root: Uri): Promise<Repository | null>
  openRepository(root: Uri): Promise<Repository | null>
}

export type APIState = 'uninitialized' | 'initialized'

export interface Repository {
  readonly rootUri: Uri
  readonly inputBox: InputBox
  readonly state: RepositoryState
  readonly ui: RepositoryUIState
  getConfigs(): Promise<Array<{ key: string; value: string }>>
  getConfig(key: string): Promise<string>
  setConfig(key: string, value: string): Promise<string>
  getGlobalConfig(key: string): Promise<string>
  getObjectDetails(treeish: string, path: string): Promise<{ mode: string; object: string; size: number }>
  detectObjectType(object: string): Promise<{ mimetype: string; encoding?: string }>
  buffer(ref: string, path: string): Promise<Buffer>
  show(ref: string, path: string): Promise<string>
  getCommit(ref: string): Promise<Commit>
  clean(paths: Array<string>): Promise<void>
  apply(patch: string, reverse?: boolean): Promise<void>
  diff(cached?: boolean): Promise<string>
  diffWithHEAD(): Promise<Array<Change>>
  diffWithHEAD(path: string): Promise<string>
  diffWith(ref: string): Promise<Array<Change>>
  diffWith(ref: string, path: string): Promise<string>
  diffIndexWithHEAD(): Promise<Array<Change>>
  diffIndexWithHEAD(path: string): Promise<string>
  diffIndexWith(ref: string): Promise<Array<Change>>
  diffIndexWith(ref: string, path: string): Promise<string>
  diffBlobs(object1: string, object2: string): Promise<string>
  diffBetween(ref1: string, ref2: string): Promise<Array<Change>>
  diffBetween(ref1: string, ref2: string, path: string): Promise<string>
  hashObject(data: string): Promise<string>
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>
  deleteBranch(name: string, force?: boolean): Promise<void>
  getBranch(name: string): Promise<Branch>
  getBranches(query: BranchQuery, cancellationToken?: CancellationToken): Promise<Array<Ref>>
  setBranchUpstream(name: string, upstream: string): Promise<void>
  getMergeBase(ref1: string, ref2: string): Promise<string>
  tag(name: string, upstream: string): Promise<void>
  deleteTag(name: string): Promise<void>
  status(): Promise<void>
  checkout(treeish: string): Promise<void>
  addRemote(name: string, url: string): Promise<void>
  removeRemote(name: string): Promise<void>
  renameRemote(name: string, newName: string): Promise<void>
  fetch(options?: { remote?: string; ref?: string; all?: boolean; prune?: boolean; depth?: number }): Promise<void>
  pull(unshallow?: boolean): Promise<void>
  push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>
  blame(path: string): Promise<string>
  log(options?: LogOptions): Promise<Array<Commit>>
  commit(message: string, opts?: CommitOptions): Promise<void>
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined
  readonly remotes: Array<Remote>
  readonly submodules: Array<Submodule>
  readonly rebaseCommit: Commit | undefined
  readonly mergeChanges: Array<Change>
  readonly indexChanges: Array<Change>
  readonly workingTreeChanges: Array<Change>
  readonly onDidChange: Event<void>
}

export interface RepositoryUIState {
  readonly selected: boolean
  readonly onDidChange: Event<void>
}

export interface Branch extends Ref {
  readonly upstream?: UpstreamRef
  readonly ahead?: number
  readonly behind?: number
  readonly commit?: string
}

export interface Ref {
  readonly type: RefType
  readonly name?: string
  readonly commit?: string
  readonly remote?: string
}

export const enum RefType {
  Head,
  RemoteHead,
  Tag,
}

export interface UpstreamRef {
  readonly remote: string
  readonly name: string
  readonly commit?: string
}

export interface Remote {
  readonly name: string
  readonly fetchUrl?: string
  readonly pushUrl?: string
  readonly isReadOnly: boolean
}

export interface Submodule {
  readonly name: string
  readonly path: string
  readonly url: string
}

export interface Commit {
  readonly hash: string
  readonly message: string
  readonly parents: Array<string>
  readonly authorDate?: Date
  readonly authorName?: string
  readonly authorEmail?: string
  readonly commitDate?: Date
  readonly refNames: Array<string>
}

export interface Change {
  readonly uri: Uri
  readonly originalUri: Uri
  readonly renameUri: Uri | undefined
  readonly status: Status
}

export const enum Status {
  INDEX_MODIFIED,
  INDEX_ADDED,
  INDEX_DELETED,
  INDEX_RENAMED,
  INDEX_COPIED,
  MODIFIED,
  DELETED,
  UNTRACKED,
  IGNORED,
  INTENT_TO_ADD,
  INTENT_TO_RENAME,
  TYPE_CHANGED,
  ADDED_BY_US,
  ADDED_BY_THEM,
  DELETED_BY_US,
  DELETED_BY_THEM,
  BOTH_ADDED,
  BOTH_DELETED,
  BOTH_MODIFIED,
}

export interface InputBox {
  value: string
}

export interface BranchQuery {
  readonly remote?: boolean
  readonly pattern?: string
  readonly count?: number
  readonly contains?: string
}

export interface LogOptions {
  readonly maxEntries?: number
  readonly path?: string
  readonly range?: string
  readonly reverse?: boolean
  readonly sortByAuthorDate?: boolean
}

export interface CommitOptions {
  all?: boolean | 'tracked'
  amend?: boolean
  signoff?: boolean
  signCommit?: boolean
  empty?: boolean
  noVerify?: boolean
  requireUserConfig?: boolean
  useEditor?: boolean
  verbose?: boolean
  postCommitCommand?: string | null
}

export const enum ForcePushMode {
  Force,
  ForceWithLease,
  ForceWithLeaseIfIncludes,
}

export const enum CancellationToken {
  None,
}

// Minimal stubs for VS Code types used in this file
interface Uri { fsPath: string }
interface Event<T> { (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Array<unknown>): unknown }
