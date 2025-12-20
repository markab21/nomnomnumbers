import { openai } from "@ai-sdk/openai";
import { embedMany, embed } from "ai";

const embeddingModel = openai.embedding("text-embedding-3-small");

/**
 * Generate embedding for a single text string
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel,
    value: text,
  });
  return embedding;
}

/**
 * Generate embeddings for multiple text strings
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: texts,
  });
  return embeddings;
}

/**
 * Get embedding dimension for OpenAI text-embedding-3-small
 */
export const EMBEDDING_DIMENSION = 1536;
