import { useOpenAI } from "@/context/OpenAIProvider";
import React from "react";
import TextArea from "../input/TextArea";

type Props = {};

export default function Tools({}: Props) {
  const { updateTools, tools } = useOpenAI();

  return (
    <TextArea
      title="Plugins"
      className="grow"
      placeholder=""
      value={tools}
      onChange={(e) => updateTools(e.target.value)}
    />
  );
}
