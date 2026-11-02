(function () {
  const databaseName = "smart-move-offline";
  const storeName = "questions";
  const entitlementPrefix = "smartMovePaidAccess:";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName, { keyPath: "subject" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Could not open offline question storage."));
    });
  }

  async function storeQuestionSet(subject, questions) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put({ subject, questions });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(new Error(`Could not save the ${subject} questions for offline use.`));
      };
      transaction.onabort = () => {
        database.close();
        reject(new Error(`Could not save the ${subject} questions for offline use.`));
      };
    });
  }

  async function readQuestionSet(subject) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(subject);
      request.onsuccess = () => {
        database.close();
        resolve(request.result?.questions || null);
      };
      request.onerror = () => {
        database.close();
        reject(new Error(`Could not read the cached ${subject} questions.`));
      };
    });
  }

  function hasPaidAccess(userId) {
    return Boolean(userId && localStorage.getItem(`${entitlementPrefix}${userId}`) === "verified");
  }

  function rememberPaidAccess(userId) {
    if (!userId) throw new Error("Cannot save offline access without a signed-in account.");
    localStorage.setItem(`${entitlementPrefix}${userId}`, "verified");
  }

  async function cacheQuestionSets(rpc) {
    const subjects = ["biology", "chemistry", "physics"];
    const questionSets = await Promise.all(subjects.map(async (subject) => {
      const cachedQuestions = await readQuestionSet(subject);
      if (Array.isArray(cachedQuestions) && cachedQuestions.length > 0) {
        return cachedQuestions.length;
      }
      const questions = await rpc("smart_move_get_questions", { p_subject: subject });
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error(`The ${subject} question set is missing and cannot be cached.`);
      }
      await storeQuestionSet(subject, questions);
      return questions.length;
    }));
    return questionSets.reduce((total, count) => total + count, 0);
  }

  window.smartMoveOffline = {
    hasPaidAccess,
    rememberPaidAccess,
    cacheQuestionSets,
    readQuestionSet,
  };
})();
