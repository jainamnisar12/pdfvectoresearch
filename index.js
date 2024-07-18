const { compile } = require("html-to-text");
const { RecursiveUrlLoader } = require("@langchain/community/document_loaders/web/recursive_url");
const { CharacterTextSplitter } = require("langchain/text_splitter");
const pdf = require("pdf-parse");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();
const { BigQuery } = require("@google-cloud/bigquery");
const bigquery = new BigQuery();
const readlineSync = require("readline-sync");
const { ChatOpenAI } = require("@langchain/openai") ;
const { HumanMessage } = require("@langchain/core/messages");
const { AIMessage } = require("@langchain/core/messages");
const colors = require("colors");

const openAiHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  };

async function loadWebData() {
  const url = "https://en.wikipedia.org/wiki/Solar_eclipse";

  const compiledConvert = compile({
    wordwrap: 130,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } }
    ]
  });

  const loader = new RecursiveUrlLoader(url, {
    extractor: compiledConvert,
    maxDepth: 1,  // Adjust the depth as needed
  });

  const docs = await loader.load();
return docs;
//   docs.forEach((doc, index) => {
//     console.log(`Document ${index + 1} Content:`);
//     console.log(doc.pageContent);
//   });
}

// main().catch(error => console.error(error));

  
  async function createEmbedding(textToEmbed) {
    try {
      const response = await fetch(`https://api.openai.com/v1/embeddings`, {
        method: "POST",
        headers: openAiHeaders,
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: textToEmbed,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        return data.data[0].embedding;
      } else {
        console.error("Error creating embedding:", response.statusText);
      }
    } catch (error) {
      console.error("Error creating embedding:", error);
    }
  }

  async function splitIntoChunk() {
    const data = await loadWebData();
    const text = data.map(doc => doc.pageContent).join(" ");
    // console.log(text);
    const splitter = new CharacterTextSplitter({
      separator: "\n\n",
      chunkSize: 500,
      chunkOverlap: 100,
    });
    const output = await splitter.createDocuments([text]);
    // console.log(output.length);
  
    //   console.log(output[0]);
  
    if (output && output.length > 0) {
      const embeddings = await Promise.all(
        output.map(async (chunk) => {
          const embedding = await createEmbedding(chunk.pageContent);
          return { text: chunk.pageContent, embedding };
        })
      );
        // console.log(embeddings);
      return embeddings;
    } else {
      console.error("Error: Invalid output structure from text splitter");
    }
  }
  
//   splitIntoChunk();

async function createTable() {
    // Creates a new table named "my_table1" in "my_dataset".
    const datasetId = "webchunk_dataset";
    const tableId = "webchunks_table";
    const schema = [
      { name: "text", type: "STRING" },
      { name: "embedding", type: "FLOAT64", mode: "REPEATED" },
    ];
  
    const options = {
      schema: schema,
      location: "US",
    };
  
    // Create a new table in the dataset
    try {
      const [table] = await bigquery
        .dataset(datasetId)
        .createTable(tableId, options);
      console.log(`Table ${table.id} created.`);
    } catch (error) {
      console.error("Error creating table:", error);
    }
  }
    // createTable();
  
    async function insertEmbedding() {
        try {
          const chunks = await splitIntoChunk();
          const datasetId = "webchunk_dataset";
          const tableId = "webchunks_table";
          const chunkSize = 500; // Adjust this size based on your data and API limits
          for (let i = 0; i < chunks.length; i += chunkSize) {
            const chunk = chunks.slice(i, i + chunkSize);
            const rows = chunk.map((chunkItem) => ({
              text: chunkItem.text,
              embedding: chunkItem.embedding,
            }));
            await bigquery.dataset(datasetId).table(tableId).insert(rows);
            console.log(`Inserted ${rows.length} row(s) in chunk starting from index ${i}`);
          }
        } catch (error) {
          console.error("Error inserting rows:", error);
          if (error.errors) {
            error.errors.forEach((err) => {
              console.error("Error details:", err.errors);
            });
          }
        }
      }
      
      // insertEmbedding();
      async function searchSimilarEmbeddings(question) {

        const questionEmbedding = await createEmbedding(question);
        // console.log(questionEmbedding)
    
        const datasetId = "chunks_dataset";
        const tableId = "chunks_table";
        const topK = 5;
      
        const embeddingString = `[${questionEmbedding.join(", ")}]`;
      
        const query = `SELECT distinct 
          base.text as text,
          FROM
          VECTOR_SEARCH(
            TABLE ${datasetId}.${tableId},
            'embedding',
              (SELECT ${embeddingString} as embedding FROM ${datasetId}.${tableId}),
            top_k => ${topK},
            distance_type => 'COSINE');`;
      
        const options = {
          query: query,
          location: "US",
        };
      
        try {
          const [rows] = await bigquery.query(options);
          // console.log("Similar texts:", rows);
          return rows;
    
        } catch (error) {
          console.error("Error querying similar embeddings:", error);
        }
      }
    //   searchSimilarEmbeddings();

   

  //   async function generateAnswer(question) {
  //     let history = [];
  //     while (true) {
  //         const userInput = readlineSync.question(colors.cyan("You: "));
  
  //         // Exit if the user types "exit"
  //         if (userInput.toLowerCase() === "exit") {
  //         console.log(colors.green("Bot: ") + "Goodbye!");
  //         return;
  //     }
  //     try {
  //       // Combine history and relevant chunks into a concatenated text
  //       const messages = history.map(([role, content]) => ({ role, content }));
  //             messages.push({ role: "user", content: userInput });
        
  //       const relevantChunks = await searchSimilarEmbeddings(question);
   
  //       const relevantTexts = relevantChunks.map((chunk) => chunk.text).join("\n");

  //       const model = new ChatOpenAI({
  //         model: "gpt-3.5-turbo",
  //         temperature: 0.9,
  //         apiKey: process.env.OPENAI_API_KEY, // In Node.js defaults to process.env.OPENAI_API_KEY
          
  //       });
    
  //       // Invoke LangChain ChatOpenAI model
  //       const response = await model.invoke(
  //         [new ChatOpenAI(relevantTexts), new HumanMessage(question)],
  //         {
  //           messages: [
  //             ...history.map((msg) => ({ role: "system", content: msg.content })),
  //             { role: "user", content: question },
  //           ],
  //           max_tokens: 100,
  //           temperature: 0.3,
  //           top_p: 1,
  //           frequency_penalty: 0,
  //           presence_penalty: 0,
  //         }
  //       );
    
  //       console.log("Answer:", response.text.trim());
  //             history.push(["user", userInput]);
  //             history.push(["assistant", response.text.trim()]);
  //     } catch (error) {
  //       console.error("Error generating answer:", error);
  //       throw error;
  //     }
  //     console.log(history)
  //   }
  // }
  //   generateAnswer("Why can a solar eclipse only be viewed from a relatively small area of the world compared to a lunar eclipse?")

  async function getAnswer() {
    console.log(colors.bold.cyan("Welcome to the Chatbot Program!"));
    console.log(colors.bold.cyan("You can start chatting with the bot."));
    const chatHistory = [];
  
    while (true) {
      const userInput = readlineSync.question(colors.magenta("You: "));
  
      if (userInput.toLowerCase() === "exit") {
        console.log(colors.yellow("Bot: ") + "Goodbye!");
        break;
      }
  
      try {
        const messages = chatHistory.map(([role, content]) => {
          if (role === 'user') {
            return new HumanMessage(content);
          } else {
            return new AIMessage(content);
          }
        });
  
        messages.push(new HumanMessage(userInput));
  
        const relevantChunks = await searchSimilarEmbeddings(userInput);
        const concatenatedChunks = relevantChunks
          .map((chunk) => chunk.text)
          .join(" ");
  
        const model = new ChatOpenAI({
          model: "gpt-3.5-turbo",
          temperature: 0.9,
          apiKey: process.env.OPENAI_API_KEY,
        });
  
        // Invoke LangChain ChatOpenAI model
        const response = await model.invoke(messages, {
          max_tokens: 100,
          temperature: 0.3,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
        });
  
        // Log the response object to understand its structure
        // console.log(response);
  
        // Assuming response.choices is the correct structure
          const completionText = response.content;
          console.log(colors.yellow("Bot: ") + completionText);
  
          // Update history with user and response
          chatHistory.push(["user", userInput]);
          chatHistory.push(["assistant", completionText]);
       
      } catch (error) {
        console.error(colors.red(error));
      }
    }
  }
  
  getAnswer();