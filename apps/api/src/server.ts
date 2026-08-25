import { createApp } from "./app.js";

const app = createApp();
const port = Number(process.env.MUSIC_TRAINER_API_PORT ?? 3001);

try {
  await app.listen({ host: "127.0.0.1", port });
  app.log.info(`Music Trainer API listening on ${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
