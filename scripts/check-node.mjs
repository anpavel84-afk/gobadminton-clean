const required = "24.21.0";
const current = process.versions.node;
if (current !== required) {
  console.error(
    `GoBadminton F-01 pins Node ${required}. Current process is ${current}.`,
  );
  console.error("Install/use the pinned Node patch before install/build.");
  process.exit(1);
}
