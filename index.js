var express = require('express');
var app = express();
app.use(express.static('./www'));

var server = require('http').Server(app);
var io = require('socket.io')(server);

// port
server.listen(process.env.PORT || 3000, function(){
	console.log('server dang chay....');
});

// tài xỉu


var Taixiu = function(){

    // cài đặt
    this.idPhien             = 0;  // id phiên đặt
    this.timeDatCuoc         = 60; // thời gian đặt cược = 60s;
    this.timechophienmoi     = 10; // thời gian chờ phiên mới = 10s;
    this.soNguoiChonTai      = 0;  // Số người đặt tài
    this.soNguoiChonXiu      = 0;  // Số người đặt xỉu
    this.tongTienDatTai      = 0;  // tổng tiền đặt tài
    this.tongTienDatXiu      = 0;  // tổng tiền đặt xỉu
    this.time                = this.timeDatCuoc;  // thời gian
    this.coTheDatCuoc        = true; // có thể đặt hay không
    this.idChonTai           = []; // array id chọn tài
    this.idChonXiu           = []; // array id chọn xỉu
    this.ketQua              = ''; // kết quá
    this.wallets             = {}; // số dư xu ảo theo phiên kết nối


    // game bắt đầu
    this.gameStart = function(){
        // code
        seft = this;
        seft.idPhien ++;
        seft.coTheDatCuoc        = true // có thể đặt
        seft.soNguoiChonTai      = 0;  // Số người đặt tài
        seft.soNguoiChonXiu      = 0;  // Số người đặt xỉu
        seft.tongTienDatTai      = 0;  // tổng tiền đặt tài
        seft.tongTienDatXiu      = 0;  // tổng tiền đặt xỉu
        seft.idChonTai           = []; // array id chọn tài
        seft.idChonXiu           = []; // array id chọn xỉu
        seft.time = seft.timeDatCuoc;
        console.log('newgame');
        io.sockets.emit('gameStart', this.ketQua);
        loopAGame = setInterval(function() {              
            seft.time--;
            io.sockets.emit('gameData', { 
                idGame        : seft.idPhien,
                soNguoiChonTai: seft.soNguoiChonTai, 
                soNguoiChonXiu: seft.soNguoiChonXiu, 
                tongTienDatTai: seft.tongTienDatTai, 
                tongTienDatXiu: seft.tongTienDatXiu, 
                soNguoiChonTai: seft.soNguoiChonTai, 
                time          : seft.time, 
            });
            ketqua = seft.gameRandomResult();
            console.log( 'idGame:' + seft.idPhien);
            console.log( 'soNguoiChonTai:' + seft.soNguoiChonTai);
            console.log( 'soNguoiChonXiu:' + seft.soNguoiChonXiu);
            console.log( 'tongTienDatTai:' + seft.tongTienDatTai);
            console.log( 'tongTienDatXiu:' + seft.tongTienDatXiu);
            console.log( 'time:' + seft.time);
            if (seft.time == 0){
                clearInterval(loopAGame);
                seft.gameOver();
            }
        }, 1000);
        // console.log( 'tongTienDatXiu:' + JSON.stringify(ketqua));

        // console.log();
    };
    // game kết thúc
    this.gameOver = function(){
        seft = this;
        seft.coTheDatCuoc  = false // không thể đặt
        seft.time = seft.timechophienmoi;
        this.ketQua =  seft.gameRandomResult();
        io.sockets.emit('gameOver', this.ketQua);
        console.log(JSON.stringify(this.ketQua));
        idWin = this.ketQua.result == 'tai' ? seft.idChonTai : seft.idChonXiu;
        idWin.forEach((data)=>{
            var payout = data.tien * 2; // trả lại cược + thưởng bằng tiền cược
            seft.wallets[data.id] = (seft.wallets[data.id] || 0) + payout;
            io.to(data.id).emit('wallet', { balance: seft.wallets[data.id] });
            io.to(data.id).emit('winGame', {
                msg: 'Bạn thắng! Nhận ' + payout.toLocaleString('vi-VN') + ' xu'
            });
        });
        loopAGame = setInterval(function() {   
            seft.time --;   
            console.log(seft.time);
            io.sockets.emit('gameData', { 
                idGame        : seft.idPhien,
                soNguoiChonTai: seft.soNguoiChonTai, 
                soNguoiChonXiu: seft.soNguoiChonXiu, 
                tongTienDatTai: seft.tongTienDatTai, 
                tongTienDatXiu: seft.tongTienDatXiu, 
                soNguoiChonTai: seft.soNguoiChonTai, 
                time          : seft.time, 
            });
            if (seft.time == 0){
                clearInterval(loopAGame);
                seft.gameStart();
            }
        }, 1000);
    };
    // đặt cược
    this.putMoney = function(id,cau,tien){
        tien = Number(tien);
        if (!Number.isSafeInteger(tien) || tien <= 0 || (cau !== 'tai' && cau !== 'xiu')) {
            return { status: 'error', error: 'Số xu cược không hợp lệ' };
        }
        if (this.wallets[id] === undefined) this.wallets[id] = 10000000;
        if (tien > this.wallets[id]) {
            return { status: 'error', error: 'Bạn không đủ xu để đặt cược' };
        }
        // nếu đang trong thời gian chờ (coTheDatCuoc == false)
        if (this.coTheDatCuoc == false){
            return {
                status  : 'error',
                error   : 'Không thể đặt, vui lòng chờ giây lát'
            };
        }
        this.wallets[id] -= tien;
        io.to(id).emit('wallet', { balance: this.wallets[id] });
        if(cau == 'tai'){
            // thêm tiền vào tổng số tiền đặt tài
            this.tongTienDatTai += tien;
            // thêm id vào list id array nếu chưa có
            if(!this.idChonTai.find(x => x.id === id)){ 
                this.idChonTai.push({
                    id   : id,
                    cau  : 'tai',
                    tien : tien
                });
                this.soNguoiChonTai ++;
            }else{
                // nếu tìm thấy thì cộng thêm tiền vô
                this.idChonTai.find(x => x.id === id).tien += tien;
            }
            
        }else if(cau == 'xiu'){
            // thêm tiền vào tổng số tiền đặt tài
            this.tongTienDatXiu += tien;
            // thêm id vào list id array nếu chưa có
            if(!this.idChonXiu.find(x => x.id === id)){ 
                this.idChonXiu.push({
                    id   : id,
                    cau  : 'xiu',
                    tien : tien
                });
                this.soNguoiChonXiu ++;
            }else{
                // nếu tìm thấy thì cộng thêm tiền vô
                this.idChonXiu.find(x => x.id === id).tien += tien;
            }
        }
        return {
            status : 'success'
        }
    }
    // random kết quả
    this.gameRandomResult = function(){
        dice1 = Math.floor(1 + Math.random()*(6));
        dice2 = Math.floor(1 + Math.random()*(6));
        dice3 = Math.floor(1 + Math.random()*(6));
        return {
            dice1    : dice1,
            dice2    : dice2,
            dice3    : dice3,
            result  : dice1 + dice2 + dice3 <= 9 ? 'xiu' : 'tai'
        };
    }
    
}

tx = new Taixiu();

io.on('connection', function (socket) {
    tx.wallets[socket.id] = 10000000;
    socket.emit('wallet', { balance: tx.wallets[socket.id] });
    socket.on('disconnect', function () { delete tx.wallets[socket.id]; });
    socket.on('pull', function (data) {
        msg = tx.putMoney(data.id,data.dice,data.money);
        socket.emit('pull', msg);
    });
});
tx.gameStart();