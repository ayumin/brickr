/** Post domain model. User posts, character posts, replies and quotes are all Posts. */
export type Post = {
  id: string;
  simulationId: string;
  /** Character id, or `USER_AUTHOR_ID` for the human user. */
  authorId: string;
  content: string;
  /** Handles referenced in the body, without the leading "@". */
  mentions: string[];
  replyTo: string | null;
  quoteOf: string | null;
  createdAt: Date;
};

/** Everything needed to persist a new post. */
export type NewPost = {
  simulationId: string;
  authorId: string;
  content: string;
  mentions: string[];
  replyTo?: string | null;
  quoteOf?: string | null;
};
