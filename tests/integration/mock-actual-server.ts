// Minimal mock Actual server for integration tests
import express from 'express';

const app = express();
app.use(express.json());

app.get('/accounts', (req, res) => {
  res.json([
    { id: '1', name: 'Checking', balance: 1000 },
    { id: '2', name: 'Savings', balance: 5000 }
  ]);
});

app.post('/transactions', (req, res) => {
  res.json({ ...req.body, id: 'tx1' });
});

export function startMockActualServer(port = 4000) {
  return app.listen(port, () => {
    console.log(`Mock Actual server running on port ${port}`);
  });
}
