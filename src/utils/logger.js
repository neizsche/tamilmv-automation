const displayProgressBar = (current, total, reason) => {
  const barLength = 30;
  const progress = Math.round((current / total) * barLength);
  const bar = "█".repeat(progress) + "-".repeat(barLength - progress);
  const percentage = ((current / total) * 100).toFixed(2);
  process.stdout.write(`\r[${bar}] (${current}/${total}) (${reason.toUpperCase()})`);
  if (current === total) process.stdout.write("\n\n");
};

const log = {
  info: (message) => console.log(`ℹ️ ${message}`),
  success: (message) => console.log(`✅ ${message}`),
  warning: (message) => console.log(`⚠️ ${message}`),
  error: (message, error = null) => {
    console.log(`❌ ${message}`);
    if (error) console.error(error);
  }
};

module.exports = { displayProgressBar, log };