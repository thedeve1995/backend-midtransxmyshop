// server.mjs 
// run node --experimental-modules server.mjs in terminal for test by Dani Sepriyanto
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors'; // Import middleware CORS
import Midtrans from 'midtrans-client';

const { Snap } = Midtrans;

const app = express();
const port = 3000;

app.use(bodyParser.json());

// Menambahkan middleware CORS
app.use(cors());

const snap = new Snap({
    isProduction: false,
    serverKey: 'SB-Mid-server-vvE5GyR1AqnJDPc6ng56K5dN', // Ganti dengan kunci server Midtrans Anda
});

// Penanganan rute untuk path root
app.get('/', (req, res) => {
    res.send('Hello, world!'); // Ganti dengan respons atau HTML yang sesuai
});

app.post('/getTransactionToken', (req, res) => {
    const parameter = req.body;

    snap.createTransaction(parameter)
        .then((transaction) => {
            const transactionToken = transaction.token;
            console.log('transactionToken:', transactionToken);
            res.json({ transactionToken });
        })
        .catch((error) => {
            console.error('Error creating transaction:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        });
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
