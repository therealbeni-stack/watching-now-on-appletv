#define DISCORDPP_IMPLEMENTATION
#include "discordpp.h"
#include <chrono>
#include <iostream>
#include <memory>
#include <string>
#include <thread>

static std::string field(const std::string& line, const std::string& key) {
  const auto p = line.find("\"" + key + "\":\"");
  if (p == std::string::npos) return {};
  auto i = p + key.size() + 4, out = std::string{};
  for (; i < line.size(); ++i) {
    char c = line[i];
    if (c == '\\' && i + 1 < line.size()) { out += line[++i]; continue; }
    if (c == '"') break;
    out += c;
  }
  return out;
}
static uint64_t number(const std::string& line, const std::string& key) {
  const auto p = line.find("\"" + key + "\":");
  if (p == std::string::npos) return 0;
  try { return std::stoull(line.substr(p + key.size() + 3)); } catch (...) { return 0; }
}

int main(int argc, char** argv) {
  if (argc < 2) { std::cerr << "usage: social_bridge <client-id>\n"; return 2; }
  const uint64_t appId = std::stoull(argv[1]);
  auto client = std::make_shared<discordpp::Client>();
  bool ready = false;

  client->SetStatusChangedCallback([&](auto status, auto error, auto details) {
    if (status == discordpp::Client::Status::Ready) { ready = true; std::cout << "{\"ready\":true}" << std::endl; }
  });

  // Presence-only use can publish to the local desktop client before Connect.
  // Authentication is only needed for connected social features.
  std::string line;
  while (true) {
    discordpp::RunCallbacks();
    if (!std::getline(std::cin, line)) break;
    if (line.find("\"type\":\"clear\"") != std::string::npos) {
      discordpp::Activity empty{};
      client->UpdateRichPresence(std::move(empty), [](auto){});
      continue;
    }
    if (line.find("\"type\":\"activity\"") == std::string::npos) continue;

    discordpp::Activity activity{};
    auto details = field(line, "details");
    auto state = field(line, "state");
    auto image = field(line, "largeImage");
    auto imageText = field(line, "largeText");
    if (!details.empty()) activity.SetDetails(details);
    if (!state.empty()) activity.SetState(state);

    if (!image.empty()) {
      discordpp::ActivityAssets assets{};
      assets.SetLargeImage(image);
      if (!imageText.empty()) assets.SetLargeText(imageText);
      activity.SetAssets(assets);
    }

    const auto start = number(line, "start");
    const auto end = number(line, "end");
    if (start || end) {
      discordpp::ActivityTimestamps ts{};
      if (start) ts.SetStart(start);
      if (end) ts.SetEnd(end);
      activity.SetTimestamps(ts);
    }

    client->UpdateRichPresence(std::move(activity), [](auto result) {
      std::cout << "{\"updated\":" << (result.Successful() ? "true" : "false") << "}" << std::endl;
    });
    discordpp::RunCallbacks();
  }
  return 0;
}
