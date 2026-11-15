// Development only: the entry of the lab's preview page (index.html beside this file). Not part of the built app.
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "../../design/fonts"
import "../../design/index.css"
import { Preview } from "./Preview"

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>)
