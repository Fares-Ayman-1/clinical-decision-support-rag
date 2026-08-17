import type {
  EvidenceDetail,
  HealthResponse,
  QueryRequest,
  QueryResult,
} from "./api";

export type TransportMode = "api" | "demo";

export interface TransportCallOptions {
  signal?: AbortSignal;
}

export type QueryStreamEvent =
  | { type: "delta"; text: string }
  | { type: "complete"; result: QueryResult }
  | { type: "retract"; message: string };

export interface ClinicalTransport {
  readonly mode: TransportMode;
  readonly capabilities: Readonly<{ streaming: boolean }>;
  health(options?: TransportCallOptions): Promise<HealthResponse>;
  query(request: QueryRequest, options?: TransportCallOptions): Promise<QueryResult>;
  evidence(chunkId: string, options?: TransportCallOptions): Promise<EvidenceDetail>;
  queryStream?(
    request: QueryRequest,
    options?: TransportCallOptions,
  ): AsyncIterable<QueryStreamEvent>;
}
