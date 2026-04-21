module.exports = {
  apps : [{
    name: 'ron-ai',
    script: 'bot.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: 'bot.err.log',
    out_file: 'bot.out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
  }]
};
