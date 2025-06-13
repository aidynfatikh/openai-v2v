import React from "react";
import Chat from "./components/Chat";

const App: React.FC = () => {
  return (
    <div style={styles.app}>
      <h1 style={styles.title}>🧠 OpenAI Voice Assistant</h1>
      <Chat />
    </div>
  );
};

const styles = {
  app: {
    fontFamily: "sans-serif",
    backgroundColor: "#f3f4f6",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "2rem",
  },
  title: {
    fontSize: "2rem",
    color: "#111827",
    marginBottom: "1rem",
  },
};

export default App;
