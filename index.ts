function calculate(operation: "add" | "subtract" | "multiply" | "divide", a: number, b: number): number | string {
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

console.log(calculate("add", 2, 3)); // 5
console.log(calculate("divide", 10, 0)); // Error: Cannot divide by zero