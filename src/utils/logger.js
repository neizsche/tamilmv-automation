const log = {
  info: (message) => console.log(`ℹ️ ${message}`),
  success: (message) => console.log(`✅ ${message}`),
  warning: (message) => console.log(`⚠️ ${message}`),
  error: (message, error = null) => {
    console.log(`❌ ${message}`);
    if (error) console.error(error);
  }
};

export default { log };