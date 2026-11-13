const accountModel = require("../models/account.model");
const ledgerModel = require("../models/ledger.model");
const transactionModel = require("../models/transaction.model");
const emailService = require("../services/email.service")
const mongoose = require('mongoose');
/*
create new transaction
the 10 steps transfer flow:
1. validate request
2. validate idempotency key
3. check account status
4. derive sender balance from ledger'
5. create transaction (PENDING)
6. create DEBIT ledger entry
7. create CREDIT ledger entry
8. Mark transaciton completed
9. commit mongodb session
10. send email notification 
*/

async function createTransaction(req, res){
    const {fromAccount, toAccount , amount, idempotencyKey} = req.body
    if(!fromAccount || !toAccount || !amount || !idempotencyKey){
        return res.status(400).json({
            message:"FromAccount, toAccount, amount and idempotencyKey are required"
        })
    }
    const fromUserAccount = await accountModel.findOne({
        _id:fromAccount
    })
    const toUserAccount = await accountModel.findOne({
        _id:toAccount
    })
    if(!fromUserAccount || !toUserAccount){
        return res.status(400).json({
            message:"Invalid fromAccount or toAccount"
        })
    }

    //Validate Idempotency Key
    const isTransactionAlreadyExists = await transactionModel.findOne({
        idempotencyKey : idempotencyKey
    })

    if(isTransactionAlreadyExists){
        if(isTransactionAlreadyExists.status === "COMPLETED"){
            return res.status(200).json({
                message:"Transaction already processed",
                transaction: isTransactionAlreadyExists
            })
        }
        if(isTransactionAlreadyExists.status === "PENDING"){
            return res.status(200).json({
                message:"Transaction is still processing",
            })

        }
        if(isTransactionAlreadyExists.status === "FAILED"){
            return res.status(500).json({
                message:"Transaction failed. Please retry ",
            })

        }
        if(isTransactionAlreadyExists.status === "REVERSED"){
            return res.status(500).json({
                message:"Transaction was reversed. Please retry",
            })

        }

    }

    // Check account status

    if(fromUserAccount.status !== "ACTIVE" || toUserAccount.status !== "ACTIVE"){
        return res.status(400).json({
            message:"Both fromAccount and toAccount must be ACTIVE to process the transaction"
        })
    }

    // Derive sender balance from ledger

    const balance = await fromUserAccount.getBalance()

    if(balance < amount){
        return res.status(400).json({
            message:`Insufficient balance. Current balance is ${balance}. Requested amount is ${amount}`
        })
    }

    let transaction;
    try{
    // create transaction (PENDING)

    const session = await mongoose.startSession()
    session.startTransaction()

    transaction = (await transactionModel.create([{
        fromAccount,
        toAccount,
        amount, 
        idempotencyKey,
        status : "PENDING"
    }],{session}))[0]

    const debitLedgerEntry = await ledgerModel.create([{
        account : fromAccount,
        amount:amount,
        transaction:transaction._id,
        type:"DEBIT",
    }],{session})

    await(()=>{
        return new Promise((resolve)=>setTimeout(resolve,15*1000));
    })()

    const creditLedgerEntry = await ledgerModel.create([{
        account : toAccount,
        amount:amount,
        transaction:transaction._id,
        type:"CREDIT",
    }],{session})

    await transactionModel.findOneAndUpdate(
        {_id: transaction._id},
        {status: "COMPLETED"},
        {session}
    )

    await session.commitTransaction()
    session.endSession()
}catch(error){
    return res.status(400).json({
        message:"Transaction pending due to some issue. Please retry after some time"
    })
}

    // send email notification

    await emailService.sendTransactionEmail(req.user.email, req.user.name, req.user.amount, toAccount)
    return res.status(201).json({
        message:"Transaction completed successfully",
        transaction : transaction
})
}

async function createInitialFundsTransaction(req, res){
    const {toAccount, amount, idempotencyKey} = req.body

    if(!toAccount || !amount || !idempotencyKey){
        return res.status(400).json({
            message:"toAccount, amount and idempotency are required"
        })
    }
    const toUserAccount = await accountModel.findOne({
        _id:toAccount,

    })
    
    if(!toUserAccount){
        return res.status(400).json({
            message:"Invalid Account"
        })
    }
    
    const fromUserAccount = await accountModel.findOne({
        user:req.user._id
    })

    if(!fromUserAccount){
        return res.status(400).json({
            message:"System user account not found"
        })
    }


    const session = await mongoose.startSession()
    session.startTransaction()

    const transaction = new transactionModel({
        fromAccount: fromUserAccount._id,
        toAccount,
        amount,
        idempotencyKey, 
        status:"PENDING",
    })

    const debitLedgerEntry = await ledgerModel.create([{
        account: fromUserAccount._id,
        amount:amount,
        transaction:transaction._id,
        type:"DEBIT" 
    }],{session})

    const creditLedgerEntry = await ledgerModel.create([{
        account: toAccount,
        amount:amount,
        transaction:transaction._id,
        type:"CREDIT" 
    }],{session})

    transaction.status = "COMPLETED"
    await transaction.save({session})

    await session.commitTransaction()
    session.endSession()

    return res.status(201).json({
        message:"Initial funds transaction completed successful",
        transaction:transaction
    })
}

module.exports = { createTransaction, createInitialFundsTransaction }