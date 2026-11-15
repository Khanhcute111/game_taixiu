const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const WEB_DIR = path.join(__dirname, 'www');
app.use(express.static(WEB_DIR));
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/', (_req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));

const PORT = Number(process.env.PORT) || 3000;
const START_BALANCE = 10000000;
const TOPUP_AMOUNT = 500000;
const ROUND_SECONDS = 45;
const WAIT_SECONDS = 8;
const names = ['Minh Anh','Hoàng Long','Gia Huy','Bảo Ngọc','Tuấn Kiệt','Khánh Linh','Đức Anh','Phương Thảo','Quốc Bảo','Hải Đăng','Ngọc Mai','Thanh Tùng','Kim Chi','Anh Khoa','Mỹ Duyên','Nhật Nam'];
const amounts = [50000,100000,200000,300000,500000,800000,1000000,1500000,2000000];
const wallets = new Map();
const histories = new Map();
let realBets = { tai: [], xiu: [] };
let botBets = { tai: 0, xiu: 0 };
let botCounts = { tai: 0, xiu: 0 };
let round = 0;
let time = ROUND_SECONDS;
let phase = 'betting';
let recent = [];
let feed = [];

function addHistory(id, item) {
  const list = histories.get(id) || [];
  list.unshift({ ...item, at: new Date().toLocaleTimeString('vi-VN') });
  histories.set(id, list.slice(0, 30));
  io.to(id).emit('history', histories.get(id));
}

function gameData() {
  return {
    round, time, phase,
    realTai: realBets.tai.length,
    realXiu: realBets.xiu.length,
    botTai: botCounts.tai,
    botXiu: botCounts.xiu,
    totalTai: realBets.tai.reduce((sum, bet) => sum + bet.amount, 0) + botBets.tai,
    totalXiu: realBets.xiu.reduce((sum, bet) => sum + bet.amount, 0) + botBets.xiu,
    recent: recent.slice(0, 12),
    feed: feed.slice(0, 12)
  };
}

function broadcast() {
  io.emit('gameData', gameData());
}

function botBet() {
  if (phase !== 'betting') return;
  const side = Math.random() < 0.5 ? 'tai' : 'xiu';
  const amount = amounts[Math.floor(Math.random() * amounts.length)];
  botBets[side] += amount;
  botCounts[side] += 1;
  feed.unshift({
    name: names[Math.floor(Math.random() * names.length)],
    side, amount
  });
  feed = feed.slice(0, 12);
  broadcast();
}

function startRound() {
  round += 1;
  phase = 'betting';
  time = ROUND_SECONDS;
  realBets = { tai: [], xiu: [] };
  botBets = { tai: 0, xiu: 0 };
  botCounts = { tai: 0, xiu: 0 };
  feed = [];
  for (let i = 0; i < 5; i += 1) botBet();
  io.emit('roundStart', { round });
  broadcast();
}

function finishRound() {
  phase = 'waiting';
  time = WAIT_SECONDS;
  const dice = [1, 2, 3].map(() => Math.floor(Math.random() * 6) + 1);
  const total = dice.reduce((sum, value) => sum + value, 0);
  const result = total <= 9 ? 'xiu' : 'tai';

  recent.unshift({ round, result, total, dice });
  recent = recent.slice(0, 12);
  io.emit('gameOver', { round, dice, result, total });

  for (const bet of realBets[result]) {
    const payout = bet.amount * 2;
    const balance = (wallets.get(bet.id) || 0) + payout;
    wallets.set(bet.id, balance);
    io.to(bet.id).emit('wallet', { balance });
    io.to(bet.id).emit('winGame', {
      msg: 'Thắng phiên #' + round + ' · +' + payout.toLocaleString('vi-VN') + ' xu'
    });
    addHistory(bet.id, { type: 'Thắng cược', amount: payout, detail: 'Phiên #' + round });
  }

  for (const bet of realBets[result === 'tai' ? 'xiu' : 'tai']) {
    addHistory(bet.id, { type: 'Thua cược', amount: bet.amount, detail: 'Phiên #' + round });
  }
  broadcast();
}

io.on('connection', (socket) => {
  wallets.set(socket.id, START_BALANCE);
  histories.set(socket.id, []);
  socket.emit('wallet', { balance: START_BALANCE });
  socket.emit('history', []);
  socket.emit('gameData', gameData());

  socket.on('pull', (data = {}) => {
    const side = data.dice;
    const amount = Number(data.money);

    if (phase !== 'betting') {
      socket.emit('pull', { status: 'error', error: 'Phiên đã khóa cược' });
      return;
    }
    if (!Number.isSafeInteger(amount) || amount < 1000) {
      socket.emit('pull', { status: 'error', error: 'Cược tối thiểu 1.000 xu' });
      return;
    }
    if (side !== 'tai' && side !== 'xiu') {
      socket.emit('pull', { status: 'error', error: 'Lựa chọn không hợp lệ' });
      return;
    }

    const balance = wallets.get(socket.id) || 0;
    if (amount > balance) {
      socket.emit('pull', { status: 'error', error: 'Bạn không đủ xu' });
      return;
    }

    wallets.set(socket.id, balance - amount);
    const existing = realBets[side].find((bet) => bet.id === socket.id);
    if (existing) existing.amount += amount;
    else realBets[side].push({ id: socket.id, amount });

    socket.emit('wallet', { balance: wallets.get(socket.id) });
    addHistory(socket.id, { type: 'Đặt ' + side.toUpperCase(), amount, detail: 'Phiên #' + round });
    socket.emit('pull', { status: 'success', message: 'Đặt cược thành công' });
    broadcast();
  });

  socket.on('topup', () => {
    const balance = (wallets.get(socket.id) || 0) + TOPUP_AMOUNT;
    wallets.set(socket.id, balance);
    socket.emit('wallet', { balance });
    addHistory(socket.id, {
      type: 'Nhận xu ảo', amount: TOPUP_AMOUNT, detail: 'Thưởng trải nghiệm miễn phí'
    });
    socket.emit('notice', { message: 'Đã cộng 500.000 xu ảo' });
  });

  socket.on('disconnect', () => {
    wallets.delete(socket.id);
    histories.delete(socket.id);
  });
});

server.on('error', (error) => {
  console.error('HTTP SERVER ERROR:', error);
  process.exitCode = 1;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Tai Xiu server ready on port ' + PORT);
  startRound();
  setInterval(() => {
    time -= 1;
    if (time <= 0) {
      if (phase === 'betting') finishRound();
      else startRound();
    } else {
      broadcast();
    }
  }, 1000);
  setInterval(botBet, 2600);
});
