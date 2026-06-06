import { crearAplicacio } from './app.js';

const PORT = process.env.PORT || 3000;
const app = crearAplicacio();

app.listen(PORT, () => {
  console.log(`Servidor escoltant a http://localhost:${PORT}`);
});