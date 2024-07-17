const pdf = require("pdf-parse");
const { CharacterTextSplitter } = require("langchain/text_splitter");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();
const { BigQuery } = require("@google-cloud/bigquery");
const bigquery = new BigQuery();

const openAiHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
};

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

// split the pdf into chunks
async function splitIntoChunks() {
  // Read the PDF file
  const dataBuffer = fs.readFileSync("./budget_speech.pdf"); // Replace with your PDF file path

  // Extract text from PDF using pdf-parse
  const pdfData = await pdf(dataBuffer);

  // Get the text content from the parsed PDF data
  const pdfText = pdfData.text;

  // Initialize your text splitter with desired options
  const splitter = new CharacterTextSplitter({
    separator: "\n\n",
    chunkSize: 250,
    chunkOverlap: 1,
  });

  // Process the extracted text
  const output = await splitter.createDocuments([pdfText]);
    if (output && output.length > 0) {
      const embeddings = await Promise.all(
        output.map(async (chunk) => {
          const embedding = await createEmbedding(chunk.pageContent);
          return { text: chunk.pageContent, embedding };
        })
      );
    //   console.log(embeddings);
      return embeddings;
    } else {
      console.log("invalid output structure from text splitter");
    }
 
}

splitIntoChunks();

async function createTable() {
  // Creates a new table named "my_table1" in "my_dataset".
  const datasetId = "chunks_dataset";
  const tableId = "chunks_table";
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
//   createTable();

async function insertEmbedding() {

    try {
        const chunks = await splitIntoChunks();
        
        const datasetId = "chunks_dataset";
        const tableId = "chunks_table";
      const rows = chunks.map((chunk) => ({
        text: chunk.text,
        embedding: chunk.embedding
      }))      
      await bigquery.dataset(datasetId).table(tableId).insert(rows);
      console.log(`Inserted ${rows.length} row(s)`);
    } catch (error) {
      console.error("Error inserting rows:", error);
      if (error.errors) {
        error.errors.forEach((err) => {
          console.error("Error details:", err.errors);
        });
      }
    }
  }
//   insertEmbedding();

async function searchSimilarEmbeddings(question) {

    const questionEmbedding = await createEmbedding(question);
    console.log(questionEmbedding)

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
      console.log("Similar texts:", rows);
      return rows;

    } catch (error) {
      console.error("Error querying similar embeddings:", error);
    }
  }
//   searchSimilarEmbeddings();


// generate an answer using openai

async function answerGeneration(question) {
    const relevantChunks = await searchSimilarEmbeddings(question);
  
    // Extract the text from relevantChunks and concatenate them
    const concatenatedChunks = relevantChunks.map(chunk => chunk.text).join("\n");
    // console.log("Concatenated chunks:", concatenatedChunks);
    const response = await fetch(`https://api.openai.com/v1/chat/completions`, {
      method: "POST",
      headers: openAiHeaders,
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: concatenatedChunks },
          { role: "user", content: question  },
        ],
        max_tokens: 100,
        temperature: 0.3,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      }),
    });
  
    if (response.ok) {
      const data = await response.json();
      console.log("Answer:", data.choices[0].message.content.trim());
    } else {
      console.error("Error generating answer:", response.statusText);
    }
  }
  
  answerGeneration("Viksit Bharat");
  