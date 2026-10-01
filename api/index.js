module.exports = (req, res) => {
  try {
    const requestHandler = require('../server.js');
    return requestHandler(req, res);
  } catch (err) {
    console.error("Vercel Function Load Error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({
      error: "FUNCTION_LOAD_ERROR",
      message: err.message,
      stack: err.stack
    }));
  }
};
