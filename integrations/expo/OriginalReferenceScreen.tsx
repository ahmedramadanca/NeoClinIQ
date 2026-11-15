import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, Pressable, View } from "react-native";
import { askOriginalReferences, type ReferenceAnswer } from "./originalReferenceAssistant";

/** Supply the *existing* authenticated Supabase client from NeoClinIQ's app. */
export default function OriginalReferenceScreen({ supabase }: { supabase: Parameters<typeof askOriginalReferences>[0] }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<ReferenceAnswer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setError(""); setResult(null); setBusy(true);
    try { setResult(await askOriginalReferences(supabase, question)); }
    catch (e) { setError(e instanceof Error ? e.message : "Reference search unavailable"); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={{ padding: 22, gap: 12 }}>
    <Text style={{fontSize: 25, fontWeight:"700", color:"#103d63"}}>Original Reference AI</Text>
    <Text>Source-grounded Canadian pharmacy study answers. NeoClinIQ does not provide original-reference downloads.</Text>
    <TextInput value={question} onChangeText={setQuestion} placeholder="Enter a clinical education question"
      multiline maxLength={3000} accessibilityLabel="Clinical education question"
      style={{ minHeight:130, borderWidth:1, borderColor:"#aac5cc", borderRadius:10, padding:14, textAlignVertical:"top" }} />
    <Pressable onPress={run} disabled={busy || question.trim().length < 8}
      accessibilityRole="button" style={{backgroundColor:"#0b7185",padding:14,borderRadius:10,opacity:busy?0.5:1}}>
      <Text style={{color:"white",fontWeight:"700",textAlign:"center"}}>Ask NeoClinIQ</Text>
    </Pressable>
    {busy ? <ActivityIndicator accessibilityLabel="Searching references" /> : null}
    {error ? <Text accessibilityRole="alert" style={{color:"#ad2525"}}>{error}</Text> : null}
    {result ? <View style={{gap:14}}>
      <Text selectable style={{fontSize:16,lineHeight:24}}>{result.answer}</Text>
      <Text style={{fontWeight:"700"}}>Source citations</Text>
      {result.citations.map((c,i)=><Text key={String(c.ref)+":"+i}>
        [{c.ref}] {c.title} — indexed passage {c.passageNumber}
      </Text>)}
      {result.insufficient_evidence ? <Text>Insufficient evidence in the indexed references.</Text> : null}
      <Text style={{color:"#5f7480"}}>Educational content; verify clinical decisions independently.</Text>
    </View> : null}
  </ScrollView>;
}
