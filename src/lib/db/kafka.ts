/**
 * Optional Kafka producer for realtime events (external consumers / bridges).
 * Set KAFKA_BROKERS (comma-separated). No-op when unset so local/Vercel stays quiet.
 *
 * Railway (same project, private network):
 *   KAFKA_BROKERS="${{Kafka.RAILWAY_PRIVATE_DOMAIN}}:9092"
 * Optional SASL (some Railway Kafka templates):
 *   KAFKA_SASL_USERNAME / KAFKA_SASL_PASSWORD / KAFKA_SSL=true
 */

import { Kafka, type Producer, logLevel, type SASLOptions } from "kafkajs";

export type KafkaRealtimePayload = {
  type: string;
  module?: string;
  entity?: string;
  revision?: string;
  at: string;
};

const globalForKafka = globalThis as unknown as {
  financeiagKafkaProducer?: Producer;
  financeiagKafkaConnect?: Promise<Producer | null>;
};

export function isKafkaConfigured(): boolean {
  return Boolean(process.env.KAFKA_BROKERS?.trim());
}

function brokers(): string[] {
  return (process.env.KAFKA_BROKERS || "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
}

function topic(): string {
  return process.env.KAFKA_TOPIC?.trim() || "financeiag.realtime";
}

function clientId(): string {
  return process.env.KAFKA_CLIENT_ID?.trim() || "financeiag";
}

function saslConfig(): SASLOptions | undefined {
  const username = process.env.KAFKA_SASL_USERNAME?.trim();
  const password = process.env.KAFKA_SASL_PASSWORD?.trim();
  if (!username || !password) return undefined;
  const mechanism = (process.env.KAFKA_SASL_MECHANISM?.trim().toLowerCase() ||
    "plain") as "plain" | "scram-sha-256" | "scram-sha-512";
  return { mechanism, username, password };
}

async function getProducer(): Promise<Producer | null> {
  if (!isKafkaConfigured()) return null;
  if (globalForKafka.financeiagKafkaProducer) {
    return globalForKafka.financeiagKafkaProducer;
  }
  if (globalForKafka.financeiagKafkaConnect) {
    return globalForKafka.financeiagKafkaConnect;
  }

  globalForKafka.financeiagKafkaConnect = (async () => {
    try {
      const sasl = saslConfig();
      const ssl =
        process.env.KAFKA_SSL === "true" || process.env.KAFKA_SSL === "1";

      const kafka = new Kafka({
        clientId: clientId(),
        brokers: brokers(),
        logLevel: logLevel.ERROR,
        connectionTimeout: 8_000,
        requestTimeout: 15_000,
        ssl,
        sasl,
      });
      const producer = kafka.producer({
        allowAutoTopicCreation: true,
        retry: { retries: 3 },
      });
      await producer.connect();
      globalForKafka.financeiagKafkaProducer = producer;
      return producer;
    } catch (error) {
      console.error(
        "[kafka] producer connect failed",
        error instanceof Error ? error.message : error,
      );
      globalForKafka.financeiagKafkaConnect = undefined;
      return null;
    }
  })();

  return globalForKafka.financeiagKafkaConnect;
}

export async function publishKafkaRealtime(
  payload: KafkaRealtimePayload,
): Promise<boolean> {
  const producer = await getProducer();
  if (!producer) return false;
  try {
    await producer.send({
      topic: topic(),
      messages: [
        {
          key: [payload.module, payload.entity].filter(Boolean).join(":") || payload.type,
          value: JSON.stringify(payload),
        },
      ],
    });
    return true;
  } catch (error) {
    console.error(
      "[kafka] send failed",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
