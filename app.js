async function startQuiz() {
  const subject = new URLSearchParams(location.search).get("subject") || "mixed";
  const subjectNames = {
    biology: "Biology",
    chemistry: "Chemistry",
    physics: "Physics",
    mixed: "Mixed Quiz",
  };
  if (!subjectNames[subject]) {
    throw new Error(`Unknown quiz subject: ${subject}`);
  }
  if (!Array.isArray(window.smartMoveQuestions)) {
    throw new Error("The built-in question bank could not be loaded.");
  }
  let questions = subject === "mixed"
    ? [...window.smartMoveQuestions]
    : window.smartMoveQuestions.filter((question) => question.subject === subject);

  if (
    !Array.isArray(questions) ||
    questions.length === 0 ||
    questions.some((question) =>
      !question ||
      typeof question.q !== "string" ||
      !Array.isArray(question.options) ||
      question.options.length !== 4 ||
      !Number.isInteger(question.answer) ||
      question.answer < 0 ||
      question.answer > 3
    )
  ) {
    throw new Error(`The ${subject} question set is missing or invalid.`);
  }

  if (subject === "mixed") {
    for (let i = questions.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
  }

  let current = 0;
  let score = 0;
  let wrongAnswers = 0;
  let answered = false;
  let answerAudioContext;

  const qtext = document.getElementById("qtext");
  const hint = document.getElementById("hint");
  const optionsDiv = document.getElementById("options");
  const feedback = document.getElementById("feedback");
  const count = document.getElementById("count");
  const scoreEl = document.getElementById("score");
  const subjectEl = document.getElementById("subject");
  const skipButton = document.getElementById("skip");
  const nextButton = document.getElementById("next");
  const menuButton = document.getElementById("menu");

  subjectEl.textContent = subjectNames[subject];
  document.title = `${subjectNames[subject]} | Smart Move`;

  function loadQuestion() {
    if (current >= questions.length) {
      localStorage.setItem("smartMoveScore", score);
      localStorage.setItem("smartMoveWrong", wrongAnswers);
      localStorage.setItem("smartMoveTotal", questions.length);
      localStorage.setItem("smartMovePlayed", current);
      localStorage.setItem("smartMoveSubject", subject);
      location.href = "results.html";
      return;
    }

    const question = questions[current];
    answered = false;
    count.textContent = `Question ${current + 1} / ${questions.length}`;
    if (subject === "mixed") {
      subjectEl.textContent = `${subjectNames[question.subject]} - Mixed Quiz`;
    }
    scoreEl.textContent = `Score: ${score}`;
    qtext.textContent = question.q;
    hint.textContent = "";
    optionsDiv.replaceChildren();
    feedback.textContent = "";
    nextButton.hidden = true;
    skipButton.hidden = false;

    question.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "opt";
      button.textContent = `${String.fromCharCode(65 + index)}) ${option}`;
      button.addEventListener("click", () => checkAnswer(index));
      optionsDiv.appendChild(button);
    });
  }

  function playAnswerSound(isCorrect) {
    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      console.error("Web Audio is not supported; answer sound effects cannot play.");
      return;
    }

    if (!answerAudioContext) {
      answerAudioContext = new AudioContextConstructor();
    }

    const notes = isCorrect
      ? [523.25, 659.25, 783.99]
      : [392, 329.63, 261.63];
    answerAudioContext.resume().then(() => {
      const startTime = answerAudioContext.currentTime;
      notes.forEach((frequency, index) => {
        const start = startTime + index * 0.12;
        const oscillator = answerAudioContext.createOscillator();
        const volume = answerAudioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        volume.gain.setValueAtTime(0.0001, start);
        volume.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
        volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        oscillator.connect(volume);
        volume.connect(answerAudioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.21);
      });
    }).catch((error) => {
      console.error("Unable to play the answer sound effect.", error);
    });
  }

  function checkAnswer(selectedIndex) {
    if (answered) return;
    answered = true;

    const question = questions[current];
    const isCorrect = selectedIndex === question.answer;
    playAnswerSound(isCorrect);
    const buttons = optionsDiv.querySelectorAll(".opt");
    buttons.forEach((button) => {
      button.disabled = true;
    });

    if (isCorrect) {
      buttons[selectedIndex].classList.add("correct");
      feedback.style.color = "#1ed760";
      feedback.textContent = "Correct!";
      score += 1;
      scoreEl.textContent = `Score: ${score}`;
    } else {
      wrongAnswers += 1;
      buttons[selectedIndex].classList.add("wrong");
      buttons[question.answer].classList.add("correct");
      feedback.style.color = "#ff4d4d";
      feedback.textContent = `Wrong. The correct answer is ${String.fromCharCode(65 + question.answer)}.`;
    }

    hint.textContent = question.explanation;
    nextButton.hidden = false;
    skipButton.hidden = true;
  }

  function nextQuestion() {
    if (!answered) return;
    current += 1;
    loadQuestion();
  }

  function skipQuestion() {
    if (answered) return;
    current += 1;
    loadQuestion();
  }

  skipButton.addEventListener("click", skipQuestion);
  nextButton.addEventListener("click", nextQuestion);
  menuButton.addEventListener("click", () => {
    location.href = "index.html";
  });

  loadQuestion();
}

startQuiz().catch((error) => {
  console.error("Smart Move quiz could not start.", error);
  const errorMessage = document.getElementById("access-error");
  errorMessage.textContent = error.message;
  const homeLink = document.createElement("a");
  homeLink.href = "index.html";
  homeLink.textContent = " Return to Smart Move.";
  homeLink.style.color = "#bcd2ef";
  errorMessage.appendChild(homeLink);
  errorMessage.hidden = false;
});
