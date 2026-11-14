import { Field, FieldLabel } from "@ui-sdk/react/field"
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectTrigger, SelectValue } from "@ui-sdk/react/select"
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack, SliderValue } from "@ui-sdk/react/slider"
import { Switch, SwitchThumb } from "@ui-sdk/react/switch"
import type { ParamSpec, Params } from "../sim/types"

interface Props {
  specs: ParamSpec[]
  values: Params
  resetOn: string[]
  onChange: (key: string, value: number | boolean | string) => void
}

export function ParamPanel({ specs, values, resetOn, onChange }: Props) {
  return (
    <div className="params">
      {specs.map((spec) => {
        const restarts = resetOn.includes(spec.key)
        const label = (
          <FieldLabel>
            {spec.label}
            {restarts && <span className="badge" title="Changing this restarts the simulation">restart</span>}
          </FieldLabel>
        )
        if (spec.type === "number")
          return (
            <Field key={spec.key} className="param">
              <Slider
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={Number(values[spec.key])}
                onValueChange={(v) => onChange(spec.key, v as number)}
              >
                <div className="param-head">
                  {label}
                  <SliderValue />
                </div>
                <SliderControl>
                  <SliderTrack>
                    <SliderIndicator />
                    <SliderThumb />
                  </SliderTrack>
                </SliderControl>
              </Slider>
            </Field>
          )
        if (spec.type === "boolean")
          return (
            <Field key={spec.key} className="param param-row">
              {label}
              <Switch checked={Boolean(values[spec.key])} onCheckedChange={(c) => onChange(spec.key, c)}>
                <SwitchThumb />
              </Switch>
            </Field>
          )
        return (
          <Field key={spec.key} className="param">
            {label}
            <Select
              items={spec.options}
              value={String(values[spec.key])}
              onValueChange={(v) => v != null && onChange(spec.key, v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {spec.options.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )
      })}
    </div>
  )
}
