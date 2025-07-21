function calculate(operation, a, b) {
  switch (operation) {
    case "add":
      return a + b;
    case "subtract":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
      if (b === 0) return "Error: Cannot divide by zero";
      return a / b;
    default:
      return "Error: Unknown operation";
  }
}