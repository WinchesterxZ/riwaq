// On Windows the query engine DLL cannot be replaced while the API is running.
// Generate on a fresh install; after schema edits stop the API and run prisma generate.
try {
  const { Prisma } = require('@prisma/client');
  if (Prisma.dmmf.datamodel.models.length > 0) process.exit(0);
} catch {
  // The client has not been generated yet.
}
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'generate'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
