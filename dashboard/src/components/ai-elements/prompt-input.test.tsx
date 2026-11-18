import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from "./prompt-input"

const create = vi.fn(() => "blob:attachment")
const revoke = vi.fn()

beforeEach(() => {
  create.mockClear(); revoke.mockClear()
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
})

describe("the prompt input without a provider", () => {
  it("submits text and an empty file list, then resets the text", async () => {
    const submit = vi.fn()
    render(<PromptInput onSubmit={submit}><PromptInputTextarea /><PromptInputSubmit /></PromptInput>)
    const box = screen.getByRole("textbox")
    fireEvent.change(box, { target: { value: "A question" } })
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ text: "A question", files: [] }, expect.anything()))
    expect(box).toHaveValue("")
  })

  it("pastes a file, converts it for submission and clears it after success", async () => {
    const submit = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["image"], { type: "image/png" }) })))
    render(<PromptInput onSubmit={submit}><PromptInputTextarea /><PromptInputSubmit /></PromptInput>)
    const file = new File(["image"], "picture.png", { type: "image/png" })
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { items: [{ kind: "file", getAsFile: () => file }] } })
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).toEqual({ text: "", files: [{ type: "file", filename: "picture.png", mediaType: "image/png", url: "data:image/png;base64,aW1hZ2U=" }] })
    expect(revoke).toHaveBeenCalledWith("blob:attachment")
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[1][0].files).toEqual([])
  })

  it("accepts a form drop and removes the last attachment with Backspace", async () => {
    const submit = vi.fn()
    render(<PromptInput onSubmit={submit}><PromptInputTextarea /><PromptInputSubmit /></PromptInput>)
    const box = screen.getByRole("textbox")
    fireEvent.drop(box.closest("form")!, { dataTransfer: { types: ["Files"], files: [new File(["data"], "data.txt")] } })
    expect(create).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(box, { key: "Backspace" })
    expect(revoke).toHaveBeenCalledWith("blob:attachment")
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ text: "", files: [] }, expect.anything()))
  })

  it("retains files when submission fails and falls back to the blob URL if conversion fails", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error("retry")).mockResolvedValueOnce(undefined)
    render(<PromptInput onSubmit={submit}><PromptInputTextarea /><PromptInputSubmit /></PromptInput>)
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { items: [{ kind: "file", getAsFile: () => new File(["data"], "data.txt") }] } })
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(revoke).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[1][0].files[0].url).toBe("blob:attachment")
    expect(revoke).toHaveBeenCalledWith("blob:attachment")
  })

  it("rejects files outside the accepted types", async () => {
    const error = vi.fn(), submit = vi.fn()
    render(<PromptInput accept="image/*" onError={error} onSubmit={submit}><PromptInputTextarea /><PromptInputSubmit /></PromptInput>)
    fireEvent.drop(screen.getByRole("textbox").closest("form")!, { dataTransfer: { types: ["Files"], files: [new File(["text"], "data.txt", { type: "text/plain" })] } })
    expect(error).toHaveBeenCalledWith({ code: "accept", message: "No files match the accepted types." })
    expect(create).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ text: "", files: [] }, expect.anything()))
  })
})
