const http = require('http')
const express = require('express')
const questions = require('./questions');
const WebSocket = require('ws')
const fs = require('fs');

const options = require("./options.json");
const app = express();
const indexFile = fs.readFileSync("./index.html", "utf-8").replace("@@HOST", options.host).replace("@@PORT", options.port);

const server = http.createServer(app)
const wss = new WebSocket.Server({ server });

wss.broadcast = function broadcast(msg) {
    wss.clients.forEach(function each(client) {
        client.send(msg);
    });
};

const GAME_WAITING = "GAME_WAITING";
const GAME_INSTRUCTIONS = "GAME_INSTRUCTIONS";
const ROUND_START = "ROUND_START";
const QUESTION_READY = "QUESTION_READY";
const QUESTION_START = "QUESTION_START";
const QUESTION_ANSWERED = "QUESTION_ANSWERED";
const QUESTION_MISSED = "QUESTION_MISSED";
const ROUND_INTERSTITIAL = "ROUND_INTERSTITIAL";
const ROUND_END = "ROUND_END";
const GAME_OVER = "GAME_OVER";

const MIN_PLAYERS = options.minPlayers;
const IDEAL_PLAYERS = options.idealPlayers;
const QUESTION_COUNT = options.questionCount;

const game = {
    phase: GAME_WAITING,
    players: [],
    roundNumber: 1,
    questionsLeft: QUESTION_COUNT,
    lastAnswer: null,
    ready: false,
    question: null,
    timer: 0,
    initialize: function () {
        if (fs.existsSync("./save.json")) {
            this.loadGame();
        }
    },
    joinPlayer: function (playerName) {
        let player = this.players.find((element) => element.name == playerName);

        if (player) {
            player.joined = true;
        } else {
            this.players.push({
                name: playerName,
                joined: true,
                ready: false,
                guessed: false,
                round: [0, 0, 0]
            })
        }
    },
    readyPlayer: function (playerName) {
        let player = this.players.find((element) => element.name == playerName);
        if (player) {
            player.ready = true;
        }
    },
    leavePlayer: function (playerName) {
        let player = this.players.find((element) => element.name == playerName);

        if (player) {
            player.joined = false;
            player.ready = false;
        }
    },
    playersJoined: function () {
        return this.players.length >= MIN_PLAYERS && this.players.every((element) => element.joined == true);
    },
    playersReady: function () {
        let joinedPlayers = this.players.filter((element) => element.joined == true);
        return joinedPlayers.every((element) => element.ready == true) && joinedPlayers.length >= MIN_PLAYERS;
    },
    checkAnswer: function (playerName, answer, ws) {
        if (this.lastAnswer || this.question == null) {
            return false;
        }

        let player = this.players.find((element) => element.name == playerName);

        if (answer == this.question.answer) {
            this.questionsLeft--;
            player.round[this.roundNumber - 1]++;
            this.lastAnswer = player.name;
            this.setPhase(QUESTION_ANSWERED, 10);
        } else {
            this.sendIncorrect(ws);
        }


    },

    saveGame: function () {
        var save = {
            phase: game.phase,
            players: game.players,
            roundNumber: game.roundNumber,
            questionsLeft: game.questionsLeft,
            question: game.question,
            timer: game.timer,
            ready: game.ready
        };

        fs.writeFileSync("./save.json", JSON.stringify(save, false, 4));
    },

    resetGame: function () {
        game.phase = GAME_WAITING;
        game.players = [];
        game.roundNumber = 1;
        game.questionsLeft = QUESTION_COUNT;
        game.question = null;
        game.timer = 0;
        game.timer = 0;
        game.ready = false;
    },

    loadGame: function () {
        let savedGame = require("./save.json");
        game.phase = savedGame.phase;
        game.players = savedGame.players;
        game.roundNumber = savedGame.roundNumber;
        game.questionsLeft = savedGame.questionsLeft;
        game.question = null;
        game.timer = savedGame.timer;
        game.ready = savedGame.ready;

        game.players.forEach((player) => { player.joined = false; player.ready = false });
    },

    setTimer: function (time) {
        this.timer = time * 10;
    },

    setPhase: function (phase, timer) {
        this.saveGame();
        this.phase = phase;

        let obj = {
            action: "setPhase",
            params: {
                phase: phase,
                game: {
                    roundNumber: this.roundNumber,
                    questionsLeft: this.questionsLeft,
                    players: this.players,
                    timer: timer || 0,
                    question: this.question,
                    ready: this.ready,
                    lastAnswer: this.lastAnswer
                }
            },
        }

        let message = JSON.stringify(obj);
        wss.broadcast(message);

        if (timer) {
            this.setTimer(timer);
        }
    },

    respondWithPhase: function (ws) {
        let obj = {
            action: "setPhase",
            params: {
                phase: this.phase,
                game: {
                    roundNumber: this.roundNumber,
                    questionsLeft: this.questionsLeft,
                    players: this.players,
                    timer: this.timer,
                    question: this.question,
                    ready: this.ready,
                    lastAnswer: this.lastAnswer
                }
            },
        }


        let message = JSON.stringify(obj);
        ws.send(message);
    },
    sendIncorrect: function (ws) {
        let message = JSON.stringify({ action: "incorrect" });
        ws.send(message);
    },
    sendPing: function () {
        this.players.forEach((element) => element.ready = false);
        let message = JSON.stringify({ action: "ping" });
        wss.broadcast(message);
    },

    processGameTick: function () {
        // If there is a timer decrement it
        if (this.timer && this.timer > 0) {
            this.timer--;
            this.timer = Math.max(0, this.timer);

            if (this.phase == GAME_INSTRUCTIONS) {
                let readyPlayers = this.players.filter((element) => element.ready == true);
                if (readyPlayers.length >= IDEAL_PLAYERS) {
                    this.timer = 0;
                }
            }
        } else {

            /**
             * If there is no timer or the timer reaches zero advance to the next phase
             */
            if (this.phase == GAME_WAITING) {
                /**
                 * Game is waiting for all players to join
                 */
                if (this.playersJoined()) {
                    this.players.forEach((element) => element.ready = false);
                    this.ready = true;
                    this.setPhase(GAME_INSTRUCTIONS, options.waitTime);
                } else {
                    // console.log("GAME CANNOT START BECAUSE ALL PLAYERS ARE NOT JOINED.")
                }
            } else if (this.phase == GAME_INSTRUCTIONS) {
                /**
                 * After game instructions start the first round
                 */
                if (this.playersReady()) {
                    this.setPhase(ROUND_START, 5);

                } else {
                    // this.debug("GAME CANNOT START BECAUSE ALL PLAYERS ARE NOT READY.")
                }
            } else if (this.phase == ROUND_START || this.phase == QUESTION_ANSWERED || this.phase == QUESTION_MISSED) {
                /**
                 * After round start signal check users are ready for question
                 */
                if (this.questionsLeft == 0) {

                    this.questionsLeft = QUESTION_COUNT;
                    this.roundNumber++;

                    if (this.roundNumber == 2) {
                        this.players.forEach((element) => element.ready = false);
                        this.ready = true;
                        this.setPhase(ROUND_INTERSTITIAL);
                    } else {
                        this.setPhase(ROUND_END, 10);
                    }


                } else {
                    this.sendPing();
                    this.setPhase(QUESTION_READY, 7);
                }

            } else if (this.phase == QUESTION_READY) {
                if (this.playersReady()) {
                    let question = questions.getQuestion();
                    console.log(question);
                    this.lastAnswer = null;
                    this.question = question;
                    this.setPhase(QUESTION_START, 20);
                } else {
                    this.sendPing();
                    // this.debug("GAME CANNOT START BECAUSE ALL PLAYERS ARE NOT READY.")
                }
            } else if (this.phase == QUESTION_START) {
                this.setPhase(QUESTION_MISSED, 10);
            } else if (this.phase == QUESTION_ANSWERED) {

            } else if (this.phase == QUESTION_MISSED) {

            } else if (this.phase == ROUND_INTERSTITIAL) {
                if (this.playersReady()) {
                    this.setPhase(ROUND_END, 10);
                }
            } else if (this.phase == ROUND_END) {
                if (this.roundNumber == 4) {
                    this.setPhase(GAME_OVER);
                } else {
                    this.setPhase(ROUND_START, 5);

                }




            } else if (this.phase == GAME_OVER) {

            }

        }

    }

}

app.use(express.static('public'))

app.get('/', function (req, res) {
    res.send(indexFile);
    // res.sendFile(__dirname + '/index.html');
})

app.get('/reset', function (req, res) {
    fs.rmSync("./save.json");
    game.resetGame();
    game.setPhase(GAME_WAITING);
    res.send("reset");
});

wss.on('connection', function (ws) {
    //console.log('new connection')

    ws.on('message', function (data) {
        data = data.toString();
        try {
            data = JSON.parse(data);
        } catch (ex) {
            // Not JSON
        }

        if (typeof data === "object") {
            var action = data.action;
            if (action == "joinPlayer") {
                if (data.player != null) {
                    game.joinPlayer(data.player);
                    if (game.phase != GAME_WAITING) {
                        game.respondWithPhase(ws);
                    }

                    game.saveGame();
                }
            } else if (action == "leavePlayer") {
                console.log(`${data.player} Leaving`)
                if (data.player != null) {
                    game.leavePlayer(data.player);

                    game.saveGame();
                }
            } else if (action == "reportReady") {
                if (data.player != null) {
                    game.joinPlayer(data.player);
                    game.readyPlayer(data.player);
                }
            } else if (action == "answer") {
                game.checkAnswer(data.player, data.answer, ws);
            } else if (action == "start") {
            } else if (action == "end") {

            }
        } else {
            // console.log(data);
        }
    });
})

setInterval(function () {
    game.processGameTick();
}, 100);

server.listen(1337, function () {
    //console.log('Server running')
});

game.initialize();