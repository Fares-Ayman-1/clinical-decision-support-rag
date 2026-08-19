/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs/promises";
import path from "path";

export interface GraphNode {
  id: string;
  type: "Exercise" | "Muscle" | "Joint" | string;
  name_ar?: string;
  name_en?: string;
  suggested_sets?: number;
  suggested_reps?: number;
  kimore_thresholds?: { min: number; max: number };
  target_muscle?: string;
  [key: string]: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

let graphMemory: GraphData | null = null;

function graphPath() {
  return path.join(process.cwd(), "graph.json");
}

function searchIndexPath() {
  return path.join(process.cwd(), "search_index.json");
}

export function buildSearchIndex(graph: GraphData) {
  const keywords: Record<string, string[]> = { ...DEFAULT_KEYWORDS };
  for (const node of graph.nodes) {
    if (node.type !== "Exercise") continue;
    const ids = [node.id];
    const muscle = graph.edges
      .filter((e) => e.source === node.id && e.relation === "Targets")
      .map((e) => e.target);
    const joints = muscle.flatMap((m) =>
      graph.edges.filter((e) => e.source === m).map((e) => e.target)
    );
    const all = [...ids, ...muscle, ...joints];
    const id = node.id.toLowerCase();
    if (id.includes("spine") || id.includes("lumbar")) {
      ["spinal", "lower_back", "ظهر", "L4-L5", "l4-l5"].forEach((k) => {
        keywords[k] = Array.from(new Set([...(keywords[k] || []), ...all]));
      });
    }
    if (id.includes("cerv") || id.includes("neck")) {
      ["neck", "cervical", "رقبة", "trapezius"].forEach((k) => {
        keywords[k] = Array.from(new Set([...(keywords[k] || []), ...all]));
      });
    }
    if (id.includes("knee") || id.includes("squat")) {
      ["knee", "ركبة", "quadriceps"].forEach((k) => {
        keywords[k] = Array.from(new Set([...(keywords[k] || []), ...all]));
      });
    }
    if (id.includes("shoulder")) {
      ["shoulder", "deltoid"].forEach((k) => {
        keywords[k] = Array.from(new Set([...(keywords[k] || []), ...all]));
      });
    }
  }
  return { keywords };
}

const DEFAULT_KEYWORDS: Record<string, string[]> = {
  lower_back: ["ext_spine_01", "m_lower_back", "joint_l4_l5"],
  "L4-L5": ["ext_spine_01", "m_lower_back", "joint_l4_l5"],
  "l4-l5": ["ext_spine_01", "m_lower_back", "joint_l4_l5"],
  ظهر: ["ext_spine_01", "m_lower_back", "joint_l4_l5"],
  spinal: ["ext_spine_01", "m_lower_back", "joint_l4_l5"],
  neck: ["cerv_flex_01", "m_trapezius", "joint_cervical"],
  رقبة: ["cerv_flex_01", "m_trapezius", "joint_cervical"],
  trapezius: ["cerv_flex_01", "m_trapezius", "joint_cervical"],
  cervical: ["cerv_flex_01", "m_trapezius", "joint_cervical"],
  glutes: ["ext_spine_01", "m_glutes", "joint_l4_l5"],
  knee: ["knee_squat_01", "m_quadriceps", "joint_knee"],
  ركبة: ["knee_squat_01", "m_quadriceps", "joint_knee"],
  quadriceps: ["knee_squat_01", "m_quadriceps", "joint_knee"],
  shoulder: ["shoulder_abd_01", "m_deltoids", "joint_glenohumeral"],
  deltoid: ["shoulder_abd_01", "m_deltoids", "joint_glenohumeral"],
};

export async function readGraph(): Promise<GraphData> {
  if (graphMemory) return graphMemory;
  try {
    const raw = await fs.readFile(graphPath(), "utf8");
    graphMemory = JSON.parse(raw) as GraphData;
    return graphMemory;
  } catch {
    graphMemory = { nodes: [], edges: [] };
    return graphMemory;
  }
}

export async function writeGraph(data: GraphData): Promise<void> {
  graphMemory = data;
  const index = buildSearchIndex(data);
  try {
    await fs.writeFile(graphPath(), JSON.stringify(data, null, 2), "utf8");
    await fs.writeFile(searchIndexPath(), JSON.stringify(index, null, 2), "utf8");
  } catch (err) {
    console.warn("Graph file write skipped (read-only environment):", err);
  }
}

export function getExerciseNodes(graph: GraphData) {
  return graph.nodes.filter((n) => n.type === "Exercise");
}
