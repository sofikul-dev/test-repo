const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// In-memory todos
let todos = [];
let idCounter = 1;

// ✅ Create a new todo
app.post('/todos', (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const todo = { id: idCounter++, title, completed: false };
  todos.push(todo);
  res.status(201).json(todo);
});

// 📖 Get all todos
app.get('/todos', (req, res) => {
  res.json(todos);
});

// 📖 Get a single todo
app.get('/todos/:id', (req, res) => {
  const todo = todos.find(t => t.id === parseInt(req.params.id));
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  res.json(todo);
});

// ✏️ Update a todo
app.put('/todos/:id', (req, res) => {
  const todo = todos.find(t => t.id === parseInt(req.params.id));
  if (!todo) return res.status(404).json({ error: 'Todo not found' });

  const { title, completed } = req.body;
  if (title !== undefined) todo.title = title;
  if (completed !== undefined) todo.completed = completed;

  res.json(todo);
});

// ❌ Delete a todo
app.delete('/todos/:id', (req, res) => {
  const index = todos.findIndex(t => t.id === parseInt(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'Todo not found' });

  const deleted = todos.splice(index, 1);
  res.json({ message: 'Todo deleted', todo: deleted[0] });
});

// 🚀 Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
