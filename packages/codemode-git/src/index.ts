export { GitHistoryConnector, type GitHistoryOptions } from "./connector";
export { ArtifactsSink, type ArtifactsSinkOptions, type GitSink } from "./sink";
export {
  FILES,
  TRAILERS,
  defaultIntent,
  parseTrailers,
  snippetsUsed,
  toCommit,
  toFinalCommit,
  type CommitContent
} from "./format";
export { MemoryFS } from "./memory-fs";
export { EXAMPLE_EMBEDDING_MODEL, indexExample, retrieveExamples, type Example } from "./examples";
