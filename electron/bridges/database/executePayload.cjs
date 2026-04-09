function buildExecutePayload(sessionId, queryOrCommand, params) {
  if (Array.isArray(queryOrCommand)) {
    return {
      sessionId,
      command: queryOrCommand.map((item) => String(item)),
    };
  }

  const payload = {
    sessionId,
    query: queryOrCommand,
  };

  if (params !== undefined) {
    payload.params = params;
  }

  return payload;
}

module.exports = {
  buildExecutePayload,
};
