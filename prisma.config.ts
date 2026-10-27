// Prisma 7 ne charge plus .env automatiquement : on le fait ici pour la CLI.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Pas le helper env() (qui échoue si la variable manque) : `prisma generate`, lancé au
    // build par postinstall, n'a pas besoin de la base. Les migrations, elles, échoueront
    // explicitement sans DATABASE_URL.
    url: process.env.DATABASE_URL ?? "",
  },
});
