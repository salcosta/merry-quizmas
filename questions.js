const questions = require("./questions.json");

function getQuestion() {
    let random = Math.floor(Math.random() * (questions.length - 1));
    let question = questions.splice(random, 1).pop();
    while (!question.c) {
        random = Math.floor(Math.random() * (questions.length - 1));
        question = questions.splice(random, 1).pop();
    }

    return question;
}

exports.getQuestion = getQuestion;