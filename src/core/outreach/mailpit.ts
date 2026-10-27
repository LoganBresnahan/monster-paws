/**
 * Mailpit's REST API, read by the transport test and by `preview` to say where
 * a message landed. Dev and test only — nothing in production knows this
 * module exists.
 */
/** Any bag of strings: the real environment, or a test's. */
type Env = Record<string, string | undefined>;

export interface MailpitMessage {
  ID: string;
  MessageID: string;
  Subject: string;
  To: { Address: string }[];
}

function apiUrlOf(env: Env): string {
  return env.MAILPIT_API_URL ?? "http://localhost:8025";
}

export async function mailpitMessages(
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<MailpitMessage[]> {
  const apiUrl = apiUrlOf(env);
  const response = await fetchImpl(`${apiUrl}/api/v1/messages?limit=200`);
  if (!response.ok) throw new Error(`Mailpit ${apiUrl} answered ${response.status}`);
  const body = (await response.json()) as { messages: MailpitMessage[] };
  return body.messages;
}

export async function mailpitMessageBody(
  id: string,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ Text: string; HTML: string }> {
  const apiUrl = apiUrlOf(env);
  const response = await fetchImpl(`${apiUrl}/api/v1/message/${id}`);
  if (!response.ok) throw new Error(`Mailpit ${apiUrl} answered ${response.status}`);
  return (await response.json()) as { Text: string; HTML: string };
}
