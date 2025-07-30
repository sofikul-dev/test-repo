const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// In-memory todos
interface Todo {
  id: number;
  title: string;
  completed: boolean;
}
let todos: Todo[] = [];
let idCounter = 1;


app.post('/todos', (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const todo = { id: idCounter++, title, completed: false };
  todos.push(todo);
  res.status(201).json(todo);
});


app.get('/todos', (req, res) => {
  // TODO: Implement pagination and filtering
  res.json(todos);
});


app.get('/todos/:id', (req, res) => {
  const todo = todos.find(t => t.id === parseInt(req.params.id));
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  res.json(todo);
});


app.put('/todos/:id', (req, res) => {
  const todo = todos.find(t => t.id === parseInt(req.params.id));
  if (!todo) return res.status(404).json({ error: 'Todo not found' });

  const { title, completed } = req.body;
  if (title !== undefined) todo.title = title;
  if (completed !== undefined) todo.completed = completed;

  res.json(todo);
});


app.delete('/todos/:id', (req, res) => {
  const index = todos.findIndex(t => t.id === parseInt(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'Todo not found' });

  const deleted = todos.splice(index, 1);
  res.json({ message: 'Todo deleted', todo: deleted[0] });
});


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
