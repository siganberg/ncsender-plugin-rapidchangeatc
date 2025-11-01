> **IMPORTANT DISCLAIMER:** This plugin is part of my personal ncSender project. If you choose to use it, you do so entirely at your own risk. I am not responsible for any damage, malfunction, or personal injury that may result from the use or misuse of this plugin. Use it with caution and at your own discretion.


# 🧰 RapidChangeATC Plugin for ncSender

The **RapidChangeATC** plugin brings automatic tool-change support and tool management directly into **ncSender**.
It dynamically generates tool-change macros on-the-fly and enhances the G-Code Visualizer with a **Tools List**, allowing you to easily manage and swap tools during a job.

---

## ✨ Features

- ⚙️ **Dynamic Tool-Change Macros**
  Automatically generates and executes the correct tool-change sequence when the G-Code calls for a new tool (`Txx`).

- 🧠 **Smart Integration with ncSender**
  Works seamlessly with ncSender’s macro system and machine states for smooth transitions between tool operations.

- 🧾 **Tools List in G-Code Visualizer**
  View all tools used in your G-Code directly within the visualizer and quickly switch or edit them before starting the job.

- 🪛 **Supports RapidChange ATC Systems**
  Designed to work perfectly with physical **RapidChange** systems (like your AutoDustBoot and ATC setups), but flexible enough for manual tool changes too.

- 🔍 **Automatic Tool Detection**
  Detects `M6` or `T` commands inside G-Code files and prepares corresponding macros.

---

## ⚙️ Installation

1. Open **ncSender** and go to  **Settigs  → Plugin**
2. Paste the latest release ZIP file link.
3. Click **Install**

---


## Usage

- Configure the first pocket location using the "Grab" button while positioned at pocket 1
- Configure the tool setter location using the "Grab" button while positioned at the tool setter
- Configure the manual tool pocket location (optional)
- Set the number of pockets, orientation, and direction
- Save configuration
- Use M6 Tn commands in your G-code for automated tool changes
- Use $TLS command for tool length measurement
- Use $POCKET1 command for manual pocket positioning

## Development

This plugin is part of the ncSender ecosystem: https://github.com/siganberg/ncSender

## License

See main ncSender repository for license information.
