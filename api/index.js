const requestHandler = require('../local-server.js');

module.exports = (req, res) => {
  try {
    return requestHandler(req, res);
  } catch (err) {
    console.error("API Function Error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ error: err.message }));
  }
};
