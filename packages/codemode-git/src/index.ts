export { GitHistoryConnector, type GitHistoryOptions } from "./connector.js";
export { ArtifactsSink, type ArtifactsSinkOptions, type GitSink } from "./sink.js";
export {
  FILES,
  TRAILERS,
  defaultIntent,
  parseTrailers,
  snippetsUsed,
  toCommit,
  toFinalCommit,
  type CommitContent
} from "./format.js";
export { MemoryFS } from "./memory-fs.js";
export { EXAMPLE_EMBEDDING_MODEL, indexExample, retrieveExamples, type Example } from "./examples.js";
