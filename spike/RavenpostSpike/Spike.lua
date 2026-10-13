-- Ravenpost's mailbox spike: what the game loaded of RavenpostSpike_Mailbox,
-- the file Ravenpost (-mailbox-spike) rewrites every 10 s with a counter. Said
-- in chat at each login and /reload, and kept in RavenpostSpikeSeen (the
-- saved file) for the record. /spike says it again (the same: nothing moves
-- without a /reload).
local MAILBOX = "RavenpostSpike_Mailbox"
local C = C_AddOns or {}
local getInfo = C.GetAddOnInfo or GetAddOnInfo
local isLoaded = C.IsAddOnLoaded or IsAddOnLoaded

local function say(msg) print("|cff8fb3d9Ravenpost spike:|r " .. msg) end

local function report(how)
  local m = RavenpostSpikeMailbox
  local name, _, _, loadable, reason = getInfo(MAILBOX)
  local seen = { at = time(), how = how, loaded = isLoaded(MAILBOX) and true or false }
  if not name then
    seen.reason = "no such addon (a new folder, not seen till a restart?)"
  elseif not seen.loaded then
    seen.reason = tostring(reason or (loadable and "loadable") or "?")
  end
  if m then
    seen.counter, seen.written, seen.notes = m.counter, m.written, #(m.notes or {})
    seen.age = time() - (m.at or time())
    local kb
    if UpdateAddOnMemoryUsage and GetAddOnMemoryUsage then
      UpdateAddOnMemoryUsage()
      kb = GetAddOnMemoryUsage(MAILBOX)
    end
    say(
      ("%s: mailbox #%d, written at %s (%d s ago), %d notes%s"):format(
        how,
        m.counter,
        m.written or "?",
        seen.age,
        seen.notes,
        kb and (", %.0f KB in memory"):format(kb) or ""
      )
    )
  else
    say(("%s: no mailbox read (%s)"):format(how, seen.reason or "loaded, but empty"))
  end
  RavenpostSpikeSeen = RavenpostSpikeSeen or {}
  table.insert(RavenpostSpikeSeen, seen)
end

local f = CreateFrame("Frame")
f:RegisterEvent("PLAYER_LOGIN") -- (at the login and after each /reload)
f:SetScript("OnEvent", function() report("loaded") end)

SLASH_RAVENPOSTSPIKE1 = "/spike"
SlashCmdList.RAVENPOSTSPIKE = function() report("asked") end
