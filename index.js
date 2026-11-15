const express = require('express');
const app = express();
app.use(express.static('./www'));
const server = require('http').Server(app);
const io = require('socket.io')(server);
server.listen(process.env.PORT || 3000, () => console.log('Tai Xiu server ready'));

const START_BALANCE = 10000000;
const TOPUP_AMOUNT = 500000;
const ROUND_SECONDS = 45;
const WAIT_SECONDS = 8;
const names = ['Minh Anh','Hoàng Long','Gia Huy','Bảo Ngọc','Tuấn Kiệt','Khánh Linh','Đức Anh','Phương Thảo','Quốc Bảo','Hải Đăng','Ngọc Mai','Thanh Tùng','Kim Chi','Anh Khoa','Mỹ Duyên','Nhật Nam'];
const amounts = [50000,100000,200000,300000,500000,800000,1000000,1500000,2000000];
const wallets = {};
const histories = {};
const realBets = {tai:[],xiu:[]};
let round = 0, time = ROUND_SECONDS, phase = 'betting';
let botBets = {tai:0,xiu:0}, botCounts = {tai:0,xiu:0};
let recent = [], feed = [];

function fmtData() {
  return {round,time,phase,realTai:realBets.tai.length,realXiu:realBets.xiu.length,
    botTai:botCounts.tai,botXiu:botCounts.xiu,
    totalTai:realBets.tai.reduce((s,b)=>s+b.amount,0)+botBets.tai,
    totalXiu:realBets.xiu.reduce((s,b)=>s+b.amount,0)+botBets.xiu,
    recent:recent.slice(0,12), feed:feed.slice(0,8)};
}
function pushHistory(id,item) {
  histories[id] = histories[id] || [];
  histories[id].unshift({...item,at:new Date().toLocaleTimeString('vi-VN')});
  histories[id] = histories[id].slice(0,30);
  io.to(id).emit('history',histories[id]);
}
function broadcast() { io.sockets.emit('gameData',fmtData()); }
function botBet() {
  if(phase!=='betting') return;
  const side=Math.random()<0.5?'tai':'xiu';
  const amount=amounts[Math.floor(Math.random()*amounts.length)];
  botBets[side]+=amount; botCounts[side]++;
  const item={name:names[Math.floor(Math.random()*names.length)],side,amount};
  feed.unshift(item); feed=feed.slice(0,12);
  broadcast();
}
function startRound() {
  round++; phase='betting'; time=ROUND_SECONDS;
  realBets={tai:[],xiu:[]}; botBets={tai:0,xiu:0}; botCounts={tai:0,xiu:0}; feed=[];
  for(let i=0;i<5;i++) botBet();
  io.sockets.emit('roundStart',{round}); broadcast();
}
function finishRound() {
  phase='waiting'; time=WAIT_SECONDS;
  const dice=[1,2,3].map(()=>Math.floor(Math.random()*6)+1);
  const total=dice.reduce((a,b)=>a+b,0);
  const result=total<=9?'xiu':'tai';
  recent.unshift({round,result,total,dice}); recent=recent.slice(0,12);
  io.sockets.emit('gameOver',{round,dice,result,total});
  realBets[result].forEach(b=>{
    const payout=b.amount*2;
    wallets[b.id]=(wallets[b.id]||0)+payout;
    io.to(b.id).emit('wallet',{balance:wallets[b.id]});
    io.to(b.id).emit('winGame',{msg:'Thắng phiên #'+round+' · +'+payout.toLocaleString('vi-VN')+' xu'});
    pushHistory(b.id,{type:'Thắng cược',amount:payout,detail:'Phiên #'+round});
  });
  Object.keys(wallets).forEach(id=>{
    const lost=realBets[result==='tai'?'xiu':'tai'].find(b=>b.id===id);
    if(lost) pushHistory(id,{type:'Thua cược',amount:lost.amount,detail:'Phiên #'+round});
  });
  broadcast();
}
io.on('connection',socket=>{
  wallets[socket.id]=START_BALANCE; histories[socket.id]=[];
  socket.emit('wallet',{balance:wallets[socket.id]});
  socket.emit('history',histories[socket.id]);
  socket.emit('gameData',fmtData());
  socket.on('pull',data=>{
    const side=data&&data.dice, amount=Number(data&&data.money);
    if(phase!=='betting') return socket.emit('pull',{status:'error',error:'Phiên đã khóa cược'});
    if(!Number.isSafeInteger(amount)||amount<1000) return socket.emit('pull',{status:'error',error:'Cược tối thiểu 1.000 xu'});
    if(side!=='tai'&&side!=='xiu') return socket.emit('pull',{status:'error',error:'Lựa chọn không hợp lệ'});
    if(amount>wallets[socket.id]) return socket.emit('pull',{status:'error',error:'Bạn không đủ xu'});
    wallets[socket.id]-=amount;
    const existing=realBets[side].find(b=>b.id===socket.id);
    if(existing) existing.amount+=amount; else realBets[side].push({id:socket.id,amount});
    socket.emit('wallet',{balance:wallets[socket.id]});
    pushHistory(socket.id,{type:'Đặt '+side.toUpperCase(),amount,detail:'Phiên #'+round});
    socket.emit('pull',{status:'success',message:'Đặt cược thành công'});
    broadcast();
  });
  socket.on('topup',()=>{
    wallets[socket.id]=(wallets[socket.id]||0)+TOPUP_AMOUNT;
    socket.emit('wallet',{balance:wallets[socket.id]});
    pushHistory(socket.id,{type:'Nhận xu ảo',amount:TOPUP_AMOUNT,detail:'Thưởng trải nghiệm miễn phí'});
    socket.emit('notice',{message:'Đã cộng 500.000 xu ảo'});
  });
  socket.on('disconnect',()=>{delete wallets[socket.id];delete histories[socket.id];});
});
startRound();
setInterval(()=>{
  time--;
  if(time<=0){
    if(phase==='betting') finishRound();
    else startRound();
  } else broadcast();
},1000);
setInterval(botBet,2600);
