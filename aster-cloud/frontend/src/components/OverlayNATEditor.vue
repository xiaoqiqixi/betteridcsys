<script setup lang="ts">
import { computed } from "vue";
import { Plus, Trash2 } from "@lucide/vue";
import { key32 } from "../api/client";
import type {
  NATForwarding,
  NATPolicy,
  NATProfile,
  OverlayGateway,
  OverlayInstanceOption,
  OverlayMemberInput,
  OverlayVPC,
} from "../api/overlay";
import { useConsole } from "../context";
import UiButton from "./UiButton.vue";
import UiSelect from "./UiSelect.vue";
const props = defineProps<{
  modelValue: NATPolicy[];
  profiles: NATProfile[];
  members: OverlayMemberInput[];
  instances: OverlayInstanceOption[];
  gateways: OverlayGateway[];
  vpcs: OverlayVPC[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: NATPolicy[]] }>();
const {
  prefs: { tr },
} = useConsole();
const profileKey = (p: NATProfile) =>
  `${p.node_id}:${p.profile_id}:${p.vpc_id}`;
const policyFor = (p: NATProfile) =>
  props.modelValue.find(
    (v) =>
      v.node_id === p.node_id &&
      v.profile_id === p.profile_id &&
      v.vpc_id === p.vpc_id,
  );
const gatewayPresent = (p: NATProfile) =>
  props.gateways.some(
    (g) =>
      g.node_id === p.node_id &&
      g.instance_id === p.gateway_instance_id &&
      g.vpc_id === p.vpc_id,
  );
const targets = (p: NATProfile) =>
  props.members
    .filter((m) => m.vpc_id === p.vpc_id && m.enabled)
    .map((m) => ({
      value: m.instance_id,
      label:
        props.instances.find((i) => i.instance_id === m.instance_id)
          ?.hostname || m.instance_id,
    }));
const name = (id: string) => props.vpcs.find((v) => v.id === id)?.name || id;
function publish(p: NATPolicy | null, old?: NATPolicy) {
  if (props.disabled) return;
  const next = props.modelValue.filter(
    (v) => v !== old && (!p || v.vpc_id !== p.vpc_id),
  );
  if (p) next.push(p);
  emit("update:modelValue", next);
}
function toggle(p: NATProfile) {
  const old = policyFor(p);
  if (old) {
    publish(null, old);
    return;
  }
  if (!gatewayPresent(p)) return;
  publish({
    id: key32(),
    node_id: p.node_id,
    vpc_id: p.vpc_id,
    gateway_instance_id: p.gateway_instance_id,
    profile_id: p.profile_id,
    profile_sha256: p.profile_sha256,
    snat_enabled: false,
    forwardings: [],
  });
}
function snat(p: NATProfile, value: string) {
  const old = policyFor(p);
  if (!old) return;
  publish({ ...old, snat_enabled: value === "true" }, old);
}
function nextPort(p: NATProfile) {
  const old = policyFor(p);
  for (const range of p.allowed_ports) {
    for (let port = range.start; port <= range.end; port++) {
      if (
        !old?.forwardings.some(
          (f) => f.protocol === range.protocol && f.public_port === port,
        )
      )
        return { protocol: range.protocol, port };
    }
  }
  return null;
}
function add(p: NATProfile) {
  const old = policyFor(p),
    next = nextPort(p);
  if (!old || !next || !targets(p).length || old.forwardings.length >= 128)
    return;
  publish(
    {
      ...old,
      forwardings: [
        ...old.forwardings,
        {
          id: key32(),
          protocol: next.protocol,
          public_port: next.port,
          target_instance_id: targets(p)[0]!.value,
          target_port: next.port,
          source_cidr: p.allowed_source_cidrs[0] || "",
        },
      ],
    },
    old,
  );
}

function change(p: NATProfile, id: string, patch: Partial<NATForwarding>) {
  const old = policyFor(p);
  if (!old) return;
  publish(
    {
      ...old,
      forwardings: old.forwardings.map((f) =>
        f.id === id ? { ...f, ...patch } : f,
      ),
    },
    old,
  );
}
function remove(p: NATProfile, id: string) {
  const old = policyFor(p);
  if (old)
    publish(
      { ...old, forwardings: old.forwardings.filter((f) => f.id !== id) },
      old,
    );
}
const missing = computed(() =>
  props.modelValue.filter(
    (p) =>
      !props.profiles.some(
        (v) =>
          v.node_id === p.node_id &&
          v.profile_id === p.profile_id &&
          v.vpc_id === p.vpc_id &&
          v.profile_sha256 === p.profile_sha256,
      ),
  ),
);
</script>
<template>
  <section class="nat-editor">
    <header>
      <h3>{{ tr("NAT 与端口转发", "NAT & port forwarding") }}</h3>
      <p>
        {{
          tr(
            "使用已批准的出口地址。源地址和端口须在允许范围内，管理网络始终受保护。",
            "Use approved egress addresses. Source networks and ports must stay within permitted ranges; management networks remain protected.",
          )
        }}
      </p>
    </header>
    <p v-if="!profiles.length" class="nat-empty">
      {{
        tr(
          "尚未配置 NAT 出口。批准节点出口后，可在此开启地址转换和端口转发。",
          "No NAT profiles configured. After an egress profile is approved, configure address translation and forwarding here.",
        )
      }}
    </p>
    <article
      v-for="profile in profiles"
      :key="profileKey(profile)"
      class="nat-profile"
      :class="{ 'is-selected': !!policyFor(profile) }"
    >
      <header class="profile-header">
        <div>
          <h4>{{ name(profile.vpc_id) }}</h4>
          <p>{{ profile.public_ipv4 }} · {{ profile.node_id }}</p>
        </div>
        <UiButton
          :disabled="
            disabled || (!policyFor(profile) && !gatewayPresent(profile))
          "
          :aria-pressed="!!policyFor(profile)"
          @click="toggle(profile)"
          >{{
            policyFor(profile)
              ? tr("移除 NAT", "Remove NAT")
              : tr("配置 NAT", "Configure NAT")
          }}</UiButton
        >
      </header>
      <p v-if="!gatewayPresent(profile)" class="field-note">
        {{
          tr(
            "请先选择此出口对应的路由网关。",
            "Select the routing gateway for this egress profile first.",
          )
        }}
      </p>
      <template v-if="policyFor(profile)"
        ><label class="field"
          >{{ tr("出站地址转换（SNAT）", "Outbound translation (SNAT)")
          }}<UiSelect
            :model-value="String(policyFor(profile)!.snat_enabled)"
            :options="[
              { value: 'false', label: tr('关闭', 'Off') },
              {
                value: 'true',
                label: tr('开启', 'On'),
                disabled: !profile.allow_snat,
              },
            ]"
            :disabled="disabled"
            :label="tr('出站地址转换', 'Outbound translation')"
            @update:model-value="snat(profile, $event)"
          /><span class="field-note">{{
            tr(
              "仅对已选择网关的目标网段生效，不开放全网默认路由。",
              "Applies only to the selected gateway destination prefixes; it does not enable an unrestricted default route.",
            )
          }}</span></label
        >
        <div
          v-for="(rule, index) in policyFor(profile)!.forwardings"
          :key="rule.id"
          class="forwarding"
        >
          <div class="rule-heading">
            <strong>{{ tr("端口映射", "Port mapping") }} {{ index + 1 }}</strong
            ><UiButton
              variant="quiet"
              :disabled="disabled"
              :aria-label="`${tr('删除端口映射', 'Remove port mapping')} ${index + 1}`"
              @click="remove(profile, rule.id)"
              ><Trash2 :size="16" aria-hidden="true"
            /></UiButton>
          </div>
          <div class="forward-grid">
            <label class="field"
              >{{ tr("协议", "Protocol")
              }}<UiSelect
                :model-value="rule.protocol"
                :options="[
                  { value: 'tcp', label: 'TCP' },
                  { value: 'udp', label: 'UDP' },
                ]"
                :label="tr('协议', 'Protocol')"
                :disabled="disabled"
                @update:model-value="
                  change(profile, rule.id, {
                    protocol: $event as 'tcp' | 'udp',
                  })
                " /></label
            ><label class="field"
              >{{ tr("公开端口", "Public port")
              }}<input
                type="number"
                min="1"
                max="65535"
                :value="rule.public_port"
                :disabled="disabled"
                @input="
                  change(profile, rule.id, {
                    public_port: Number(
                      ($event.target as HTMLInputElement).value,
                    ),
                  })
                " /></label
            ><label class="field target-field"
              >{{ tr("目标实例", "Target instance")
              }}<UiSelect
                :model-value="rule.target_instance_id"
                :options="targets(profile)"
                :label="tr('目标实例', 'Target instance')"
                :disabled="disabled"
                @update:model-value="
                  change(profile, rule.id, { target_instance_id: $event })
                " /></label
            ><label class="field"
              >{{ tr("目标端口", "Target port")
              }}<input
                type="number"
                min="1"
                max="65535"
                :value="rule.target_port"
                :disabled="disabled"
                @input="
                  change(profile, rule.id, {
                    target_port: Number(
                      ($event.target as HTMLInputElement).value,
                    ),
                  })
                " /></label
            ><label class="field source-field"
              >{{ tr("允许访问的来源网段", "Allowed source prefix")
              }}<input
                :value="rule.source_cidr"
                :disabled="disabled"
                autocomplete="off"
                spellcheck="false"
                @input="
                  change(profile, rule.id, {
                    source_cidr: ($event.target as HTMLInputElement).value,
                  })
                "
              /><span class="field-note"
                >{{ tr("批准范围：", "Approved ranges: ")
                }}{{ profile.allowed_source_cidrs.join(", ") }}</span
              ></label
            >
          </div>
        </div>
        <UiButton
          class="add-forwarding"
          :disabled="
            disabled ||
            !targets(profile).length ||
            !profile.allowed_source_cidrs.length ||
            !nextPort(profile) ||
            (policyFor(profile)?.forwardings.length || 0) >= 128
          "
          @click="add(profile)"
          ><Plus :size="16" aria-hidden="true" />{{
            tr("添加端口映射", "Add port mapping")
          }}</UiButton
        >
        <p class="field-note">
          {{ tr("允许端口：", "Allowed ports: ")
          }}{{
            profile.allowed_ports
              .map((p) => `${p.protocol.toUpperCase()} ${p.start}–${p.end}`)
              .join(", ")
          }}
        </p>
      </template>
    </article>
    <p v-for="item in missing" :key="item.id" class="nat-warning" role="alert">
      {{
        tr(
          "现有 NAT 配置的批准范围已变化。请重新核对，不会自动移除原策略。",
          "The approval for an existing NAT policy has changed. Verify it before proceeding; the original policy is not removed automatically.",
        )
      }}<code>{{ item.id }}</code>
    </p>
  </section>
</template>
<style scoped>
.nat-editor > header {
  margin-bottom: 18px;
}
.nat-editor h3 {
  font-size: 17px;
  margin: 0;
}
.nat-editor header p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--secondary);
  margin: 10px 0 0;
}
.nat-empty {
  font-size: 13px;
  line-height: 1.7;
  background: var(--subtle);
  color: var(--secondary);
  padding: 18px;
  border-radius: 10px;
}
.nat-profile {
  border: 1px solid var(--border);
  padding: 18px;
  border-radius: 12px;
  margin-top: 12px;
  min-width: 0;
}
.nat-profile.is-selected {
  border-color: var(--accent);
}
.profile-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 20px;
}
.profile-header > div {
  min-width: 0;
}
.profile-header h4 {
  margin: 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.profile-header p {
  overflow-wrap: anywhere;
}
.forwarding {
  border-top: 1px solid var(--border);
  margin-top: 24px;
  padding-top: 14px;
}
.rule-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 14px;
}
.forward-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.source-field {
  grid-column: 1/-1;
}
.add-forwarding {
  margin-top: 20px;
}
.nat-warning {
  padding: 14px;
  line-height: 1.6;
  font-size: 13px;
  background: var(--warning-bg);
  color: var(--warning);
  border-radius: 10px;
}
.nat-warning code {
  display: block;
  overflow-wrap: anywhere;
}
@media (max-width: 420px) {
  .forward-grid {
    grid-template-columns: 1fr;
  }
  .profile-header {
    flex-direction: column;
    align-items: stretch;
  }
  .nat-profile {
    padding: 14px;
  }
}
</style>
