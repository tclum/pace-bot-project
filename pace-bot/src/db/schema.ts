import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const corpusValues = ["org", "curriculum"] as const;
export type Corpus = (typeof corpusValues)[number];

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  source: text("source").notNull(),
  title: text("title"),
  corpus: text("corpus").notNull().default("org"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    corpus: text("corpus").notNull().default("org"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    embeddingIdx: index("document_chunks_embedding_hnsw")
      .using("hnsw", t.embedding.op("vector_cosine_ops")),
    documentIdIdx: index("document_chunks_document_id_idx").on(t.documentId),
    corpusIdx: index("document_chunks_corpus_idx").on(t.corpus),
  }),
);

export const programs = pgTable("programs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  shortDescription: text("short_description").notNull(),
  longDescription: text("long_description"),
  eligibility: text("eligibility"),
  applicationUrl: text("application_url"),
  nextDeadline: date("next_deadline"),
  awardAmountMin: integer("award_amount_min"),
  awardAmountMax: integer("award_amount_max"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    programId: uuid("program_id").references(() => programs.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location"),
    registrationUrl: text("registration_url"),
    isPublic: boolean("is_public").notNull().default(true),
  },
  (t) => ({
    startsAtIdx: index("events_starts_at_idx").on(t.startsAt),
    programIdIdx: index("events_program_id_idx").on(t.programId),
  }),
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    bio: text("bio"),
    programSlugs: text("program_slugs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    emailPublic: text("email_public"),
    isCurrent: boolean("is_current").notNull().default(true),
  },
  (t) => ({
    programSlugsIdx: index("people_program_slugs_gin")
      .using("gin", t.programSlugs),
  }),
);

export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    shortDefinition: text("short_definition").notNull(),
    longExplanation: text("long_explanation").notNull(),
    pacificAsianContext: text("pacific_asian_context"),
    exampleVentures: jsonb("example_ventures")
      .notNull()
      .default(sql`'[]'::jsonb`),
    relatedConceptSlugs: text("related_concept_slugs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    categoryIdx: index("concepts_category_idx").on(t.category),
    relatedSlugsIdx: index("concepts_related_slugs_gin")
      .using("gin", t.relatedConceptSlugs),
  }),
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;
export type Program = typeof programs.$inferSelect;
export type NewProgram = typeof programs.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type Concept = typeof concepts.$inferSelect;
export type NewConcept = typeof concepts.$inferInsert;
