require('babel-polyfill');
const Conference = artifacts.require("Conference.sol");
const InvitationRepository = artifacts.require("./InvitationRepository.sol");
const ConfirmationRepository = artifacts.require("./ConfirmationRepository.sol");
const invalid_jump_error = /Error: VM Exception while processing transaction: invalid JUMP/;
const deposit = Math.pow(10,17);
const twitterHandle = '@bighero6';
const gas = 1000000;

contract('Conference', function(accounts) {
  const owner = accounts[0];
  const non_owner = accounts[1];
  let conference;

  beforeEach(async function(){
    conference = await Conference.new();
  })

  describe('on setLimitOfParticipants', function(){
    it('does not allow to register more than the limit', async function(){
      await conference.setLimitOfParticipants(1)
      await conference.register(twitterHandle, {value:deposit});
      assert.strictEqual((await conference.registered.call()).toNumber(), 1);
      await conference.register('anotherName', {from: non_owner, value:deposit}).catch(function(){});
      assert.strictEqual((await conference.registered.call()).toNumber(), 1);
    })

    it('returns only your deposit for multiple invalidations', async function(){
      await conference.setLimitOfParticipants.sendTransaction(2);
      await conference.register.sendTransaction(twitterHandle, {value:deposit});
      await conference.register.sendTransaction('anotherName', {from: accounts[1], value:deposit});
      assert.strictEqual((await conference.registered.call()).toNumber(), 2);
      let invalidTransaction = (deposit / 2);
      let beforeAccountBalance = web3.eth.getBalance(accounts[2]).toNumber();
      // Over capacity as well as wrong deposit value.
      await conference.register('anotherName', {from: accounts[2], value:invalidTransaction}).catch(function(){});
      assert.strictEqual((await conference.registered.call()).toNumber(), 2);
      assert.strictEqual(web3.eth.getBalance(conference.address).toNumber(), 2 * deposit);
      // does not become exactly equal because it loses some gas.
      assert.strictEqual(beforeAccountBalance > web3.eth.getBalance(accounts[2]).toNumber(), true);
    })
  })

  describe('on creation', function(){
    it('has default values', async function(){
      assert.strictEqual(await conference.name.call(), 'Test');
      assert.strictEqual((await conference.registered.call()).toNumber(), 0);
      assert.strictEqual((await conference.attended.call()).toNumber(), 0);
      assert.strictEqual((await conference.totalBalance.call()).toNumber(), 0);
    })
  })

  describe('register with invitation', function(){
    let invitation, invitation_code, encrypted_code;

    beforeEach(async function(){
      invitation = await InvitationRepository.new();
      invitation_code = web3.fromUtf8('1234567890');
      encrypted_code = await invitation.encrypt.call(invitation_code);
      await invitation.add([encrypted_code], {from:owner});
      conference = await Conference.new(600, invitation.address,0);
    })

    it('allows registration only if invited', async function(){
      await conference.registerWithInvitation(twitterHandle, invitation_code, {from:non_owner, value:deposit})
      let result = await conference.registered.call();
      assert.equal(result, 1);
      let report_result = await invitation.report.call(invitation_code);
      assert.equal(report_result, non_owner);
    })

    it('does not allow registration if not invited', async function(){
      await conference.registerWithInvitation(twitterHandle, 'invalid_code', {from:non_owner, value:deposit}).catch(function(){});
      let result = await conference.registered.call();
      assert.equal(result, 0);
    })
  })

  describe('on registration', function(){
    let beforeContractBalance, beforeAccountBalance;

    beforeEach(async function(){
      beforeContractBalance = web3.eth.getBalance(conference.address).toNumber();
      await conference.register.sendTransaction(twitterHandle, {value:deposit});
    })

    it('increments registered', async function(){
      assert.equal((await conference.registered.call()).toNumber(), 1);
    })

    it('increases totalBalance', async function(){
      assert.equal((await conference.totalBalance.call()) - beforeContractBalance , deposit);
    })

    it('isRegistered for the registered account is true', async function(){
      assert.equal(await conference.isRegistered.call(owner), true);
    })

    it('isRegistered for the different account is not true', async function(){
      assert.equal(await conference.isRegistered.call(non_owner), false);
    })
  })

  describe('on failed registration', function(){
    it('cannot be registered if wrong amount of deposit is sent', async function(){
      let wrongDeposit = 5;
      let beforeContractBalance = web3.eth.getBalance(conference.address);
      await conference.register.sendTransaction(twitterHandle, {from:owner, value:wrongDeposit}).catch(function(){});
      assert.strictEqual(web3.eth.getBalance(conference.address).toNumber(), beforeContractBalance.toNumber());
      assert.equal(await conference.isRegistered.call(owner), false);
    })
  })

  describe('on attend', function(){
    beforeEach(async function(){
      await conference.register(twitterHandle, {value:deposit, from:non_owner});
    })

    it('isAttended is true if owner calls attend function', async function(){
      await conference.attend([non_owner], {from:owner});
      assert.equal(await conference.isAttended.call(non_owner), true);
      assert.equal((await conference.attended.call()).toNumber(), 1);
    })

    it('isAttended is false if non owner calls attend function', async function(){
      await conference.attend([non_owner], {from:non_owner}).catch(function(){});
      assert.equal(await conference.isAttended.call(non_owner), false);
      assert.equal(await conference.attended.call(), 0);
      let participant = await conference.participants.call(non_owner);
      assert.equal(participant[2], false)
    })

    it('isAttended is false if attended function for the account is not called', async function(){
      assert.equal(await conference.isAttended.call(owner), false);
    })
  })

  describe('self attend with code', function(){
    let confirmation, confirmation_code, encrypted_code, verified;
    beforeEach(async function(){
      confirmation = await ConfirmationRepository.new();
      confirmation_code = web3.fromUtf8('1234567890');
      encrypted_code = await confirmation.encrypt.call(confirmation_code);
      await confirmation.add([encrypted_code], {from:owner});
      verified = await confirmation.verify.call(confirmation_code);
      assert.equal(verified, true);
      conference = await Conference.new(600, 0, confirmation.address);
    })

    it('allows participant to attend with code', async function(){
      await conference.register(twitterHandle, {from:non_owner, value:deposit})
      await conference.attendWithConfirmation(confirmation_code, {from:non_owner})
      assert.equal(await conference.attended.call(), 1);
      assert.equal(await confirmation.report.call(confirmation_code), non_owner);
    })

    it('does not allow participants to attend with same code', async function(){
      let non_owner_2 = accounts[2];
      await conference.register(twitterHandle, {from:non_owner, value:deposit});
      await conference.register(twitterHandle, {from:non_owner_2, value:deposit});
      await conference.attendWithConfirmation(confirmation_code, {from:non_owner});
      await conference.attendWithConfirmation(confirmation_code, {from:non_owner_2}).catch(function(){});
      assert.equal(await conference.attended.call(), 1);
      assert.equal(await confirmation.report.call(confirmation_code), non_owner);
    })
  })

  describe('on payback', function(){
    let previousBalance, currentRegistered, currentAttended;
    let attended = accounts[2];
    var notAttended = accounts[3];
    var notRegistered = accounts[4];

    beforeEach(async function(){
      await conference.register(twitterHandle, {from:attended, value:deposit});
      await conference.register(twitterHandle, {from:notAttended, value:deposit});
      await conference.attend([attended]);
    })

    it('cannot withdraw if non owner calls', async function(){
      await conference.payback({from:non_owner}).catch(function(){});
      await conference.withdraw({from:attended});
      // money is still left on contract
      assert.strictEqual(web3.eth.getBalance(conference.address).toNumber(), deposit * 2);
    })

    it('cannot withdraw if you did not attend', async function(){
      await conference.payback({from:owner});
      await conference.withdraw({from:notAttended});
      // money is still left on contract
      assert.strictEqual(web3.eth.getBalance(conference.address).toNumber(), deposit * 2);
    })

    it('can withdraw if you attend', async function(){
      await conference.payback({from:owner});
      previousBalance = web3.eth.getBalance(attended);
      assert.strictEqual(web3.eth.getBalance(conference.address).toNumber(), deposit * 2);
      await conference.withdraw({from:attended});
      assert.strictEqual(web3.eth.getBalance(conference.address).toNumber(), 0);
      let diff = web3.eth.getBalance(attended).toNumber() - previousBalance.toNumber();
      assert( diff > (deposit * 1.9));
      let participant = await conference.participants.call(attended);
      assert.equal(participant[4], true);
    })

    it('cannot register any more', async function(){
      await conference.payback({from:owner});
      currentRegistered = await conference.registered.call();
      await conference.register('some handler', {from:notRegistered, value:deposit});
      assert.strictEqual((await conference.registered.call()).toNumber(), currentRegistered.toNumber());
      assert.equal(await conference.ended.call(), true);
    })

    // This is faiing. Potentially bug;
    // it('cannot attend any more', async function(){
    //   await conference.payback({from:owner});
    //   currentAttended = await conference.attended.call();
    //   await conference.attend([notAttended], {from:owner});
    //   assert.strictEqual((await conference.attended.call()).toNumber(), currentAttended.toNumber());
    //   assert.equal(await conference.ended.call(), true);
    // })
    // it('cannot payback any more', async function(){})
  })

  describe('on cancel', function(){
    it('cannot be canceld if non owner calls', async function(){
      let previousBalances = [];
      let conference = await Conference.new();
      await conference.register(twitterHandle, {from:owner, value:deposit, gas:gas});
      // contract gets 1 ether
      assert.strictEqual(web3.eth.getBalance(conference.address).toNumber(), deposit);
      // only account 0 and 1 attend
      previousBalances[0] = web3.eth.getBalance(owner);
      await conference.cancel({from:non_owner, gas:gas}).catch(function(){});
      // money is still left on contract
      assert.strictEqual(web3.eth.getBalance(conference.address).toNumber(), deposit);
      // did not get deposit back
      assert.strictEqual(previousBalances[0].toNumber(), web3.eth.getBalance(accounts[0]).toNumber());
    })

    it('everybody receives refund', function(done){
      var meta
      var previousBalances = [];

      var balanceDiff = function(index){
        var realDiff = web3.fromWei(web3.eth.getBalance(accounts[index]).minus(previousBalances[index]), "ether");
        // Ignore small diff introduced by gas price;
        var roundedDiff = Math.round(realDiff * 10) / 10;
        return roundedDiff;
      }
      // 3 registrations
      Conference.new().then(function(_meta) {
        meta = _meta;
        return meta.register.sendTransaction(twitterHandle, {from:accounts[0], value:deposit, gas:gas})
      }).then(function() {
        return meta.register.sendTransaction('@Cpt_Reliable', {from:accounts[1], value:deposit, gas:gas})
      }).then(function(){
        return meta.register.sendTransaction('@FLAKEY_99p', {from:accounts[2], value:deposit, gas:gas})
      }).then(function(){
        // contract gets 3 ethers
        assert.strictEqual(web3.eth.getBalance(meta.address).toNumber(), deposit * 3)
        // only account 0 and 1 attend
      }).then(function(){
        return meta.attend.sendTransaction([accounts[0], accounts[1]], {gas:gas})
      }).then(function(){
        previousBalances[0] = web3.eth.getBalance(accounts[0]);
        previousBalances[1] = web3.eth.getBalance(accounts[1]);
        previousBalances[2] = web3.eth.getBalance(accounts[2]);
        return meta.cancel.sendTransaction({from:accounts[0], gas:gas})
      }).then(function(){
        return meta.withdraw.sendTransaction({from:accounts[0], gas:gas})
      }).then(function(){
        return meta.withdraw.sendTransaction({from:accounts[1], gas:gas})
      }).then(function(){
        return meta.withdraw.sendTransaction({from:accounts[2], gas:gas})
      }).then(function(){
        // no money is left on contract
        assert.strictEqual(web3.eth.getBalance(meta.address).toNumber(), 0)
        // got deposit back
        assert.strictEqual(balanceDiff(0), 0.1)
        assert.strictEqual(balanceDiff(1), 0.1)
        assert.strictEqual(balanceDiff(2), 0.1)
      })
      .then(done).catch(done);
    })

    it('cannot register any more', function(done){
      var meta;
      var currentRegistered;

      Conference.new().then(function(_meta) {
        meta = _meta;
      }).then(function(){
        return meta.cancel.sendTransaction({from:owner, gas:gas})
      }).then(function(){
        return meta.registered.call()
      }).then(function(registered){
        currentRegistered = registered
        return meta.register.sendTransaction('some handler', {from:accounts[1], value:deposit, gas:gas})
      }).then(function(){
        return meta.registered.call()
      }).then(function(registered){
        assert.equal(currentRegistered.toNumber(), registered.toNumber())
      }).then(function(){
        return meta.ended.call()
      }).then(function(ended){
        assert.equal(ended, true)
      })
      .then(done).catch(done);
    })

    it('cannot be canceled if the event is already ended', function(done){
      var meta;
      var currentRegistered;

      Conference.new().then(function(_meta) {
        meta = _meta;
        return meta.register.sendTransaction(twitterHandle, {from:accounts[0], value:deposit, gas:gas})
      }).then(function(){
        // contract gets 1 ether
        assert.strictEqual(web3.eth.getBalance(meta.address).toNumber(), deposit)
        return meta.attend.sendTransaction([accounts[0]], {gas:gas})
      }).then(function(){
        return meta.payback.sendTransaction({from:owner, gas:gas})
      }).then(function(){
        return meta.registered.call()
      }).then(function(registered){
        currentRegistered = registered
        return meta.cancel.sendTransaction()
      }).then(function(){
        return meta.registered.call()
      }).then(function(registered){
        assert.strictEqual(currentRegistered.toNumber(), registered.toNumber())
      }).then(function(){
        return meta.ended.call()
      }).then(function(ended){
        assert.equal(ended, true)
      })
      .then(done).catch(done);

    })
  })

  describe('on withdraw', function(){
    it('cannot withdraw if no payout', function(done){
      var meta
      var previousBalances = [];
      var registered = accounts[1];
      var notRegistered = accounts[2];
      Conference.new().then(function(_meta) {
        meta = _meta;
        return meta.register.sendTransaction(twitterHandle, {from:registered, value:deposit, gas:gas})
      }).then(function(){
        assert.strictEqual(web3.eth.getBalance(meta.address).toNumber(), deposit)
      }).then(function(){
        return meta.cancel({from:owner, gas:gas})
      }).then(function(cancel_result){
        previousBalances[0] = web3.eth.getBalance(notRegistered);
        return meta.withdraw({from:notRegistered, gas:gas})
      }).then(function(result){
        // money is still left on contract
        assert.strictEqual(web3.eth.getBalance(meta.address).toNumber(), deposit)
      })
      .then(done).catch(done);
    })

    it('cannot withdraw twice', function(done){
      var meta
      var registered = accounts[1];
      Conference.new().then(function(_meta) {
        meta = _meta;
        return meta.register.sendTransaction(twitterHandle, {from:owner, value:deposit, gas:gas})
      }).then(function(){
        return meta.register.sendTransaction(twitterHandle, {from:registered, value:deposit, gas:gas})
      }).then(function(){
        assert.strictEqual( web3.eth.getBalance(meta.address).toNumber(), deposit * 2)
      }).then(function(){
        return meta.cancel.sendTransaction({from:owner, gas:gas})
      }).then(function(){
        return meta.withdraw.sendTransaction({from:registered, gas:gas})
      }).then(function(transaction){
        return meta.withdraw.sendTransaction({from:registered, gas:gas})
      }).then(function(transaction){
        // only 1 ether is taken out
        assert.strictEqual(web3.eth.getBalance(meta.address).toNumber(), deposit)
      })
      .then(done).catch(done);
    })
  })

  describe('on clear', function(){
    it('default cooling period is 1 week', function(done){
      Conference.new().then(function(meta) {
        return meta.coolingPeriod.call();
      }).then(function(coolingPeriod){
        assert.equal(coolingPeriod.toNumber(), 1 * 60 * 60 * 24 * 7)
      })
      .then(done).catch(done);
    })

    it('cooling period can be set', function(done){
      Conference.new(10, 0, 0).then(function(meta) {
        return meta.coolingPeriod.call();
      }).then(function(coolingPeriod){
        assert.equal(coolingPeriod.toNumber(), 10)
      })
      .then(done).catch(done);
    })

    it('cannot be cleared by non owner', async function(){
      let conference = await Conference.new(10, 0);
      await conference.register('one', {value:deposit});
      assert.strictEqual(web3.eth.getBalance(conference.address).toNumber(), deposit);
      await conference.clear('one', {from:non_owner}).catch(function(){});
      assert.strictEqual(web3.eth.getBalance(conference.address).toNumber(), deposit);
    })

    it('cannot be cleared if event is not ended', function(done){
      let meta;
      Conference.new().then(function(_meta) {
        meta = _meta
        return meta.register.sendTransaction('one', {value:deposit});
      }).then(function(){
        assert.strictEqual(web3.eth.getBalance(meta.address).toNumber(), deposit)
        return meta.clear.sendTransaction('one', {from:owner});
      }).then(function(){
        assert.strictEqual(web3.eth.getBalance(meta.address).toNumber(), deposit)
      })
      .then(done).catch(done);
    })

    it('cannot be cleared if cooling period is not passed', function(done){
      let meta;
      Conference.new().then(function(_meta) {
        meta = _meta
        return meta.register.sendTransaction('one', {value:deposit});
      }).then(function(){
        return meta.cancel.sendTransaction({from:owner});
      }).then(function(){
        return meta.ended.call()
      }).then(function(ended){
        assert.equal(ended, true)
        assert.strictEqual( web3.eth.getBalance(meta.address).toNumber(), deposit)
        return meta.clear.sendTransaction('one', {from:owner});
      }).then(function(){
        assert.equal(web3.eth.getBalance(meta.address).toNumber(), deposit)
      })
      .then(done).catch(done);
    })

    it('owner receives the remaining if cooling period is passed', function(done){
      let meta;
      Conference.new(1, 0, 0).then(function(_meta) {
        meta = _meta
        return meta.register.sendTransaction('one', {value:deposit});
      }).then(function(){
        return meta.cancel.sendTransaction({from:owner});
      }).then(function(){
        return meta.ended.call()
      }).then(function(ended){
        assert.equal(ended, true)
        assert.strictEqual(web3.eth.getBalance(meta.address).toNumber(), deposit)
        var previousBalance = web3.eth.getBalance(owner);
        setTimeout(function(){
          meta.clear.sendTransaction('one', {from:owner}).then(function(transaction){
            var receipt = web3.eth.getTransactionReceipt(transaction)
            assert.equal(web3.eth.getBalance(meta.address).toString(), web3.toWei(0, "ether"))
            done()
          }).catch(done)
        }, 2000)
      }).catch(done);
    })
  })
})
