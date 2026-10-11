export { GitHistoryConnector, type GitHistoryOptions } from "./connector";
export { ArtifactsSink, type ArtifactsSinkOptions, type GitSink } from "./sink";
export {
  FILES,
  TRAILERS,
  defaultIntent,
  parseTrailers,
  snippetsUsed,
  toCommit,
  type CommitContent
} from "./format";
export { MemoryFS } from "./memory-fs";
